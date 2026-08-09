use nodex_core_contracts::events::{
    AuthorizedDeliveryAtom, AuthorizedDeliveryPacket, AuthorizedDocumentEffect,
    CommitManifestHeader, DeliveryAuthorizationScope, DeliveryCoverage, DocumentEffectRef,
    LocalProjectionScope, ResourceKey, ResourceRevocation,
};
use nodex_core_contracts::{AdapterKind, BoundModuleContext};
use rusqlite::Connection;
use serde::Serialize;
use sha2::{Digest, Sha256};

use super::local_commit::{self, LocalCommitResourceMode};
use super::sqlite::{StoreError, StoreErrorCode};

const DELIVERY_PACKET_VERSION: u32 = 3;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum DeliveryResourceMode {
    RefOnly,
    Inline,
    ProjectionOnly,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum DeliveryAudience {
    BoundScope,
    HostLibraryBroker,
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct DeliveryRequest<'a> {
    pub context: &'a BoundModuleContext,
    pub audience: DeliveryAudience,
    pub document_id: Option<&'a str>,
    pub resource_mode: DeliveryResourceMode,
}

#[derive(Serialize)]
struct CanonicalPacket<'a> {
    hash_version: u32,
    packet_version: u32,
    authorization_scope: &'a DeliveryAuthorizationScope,
    manifest: &'a CommitManifestHeader,
    atoms: &'a [AuthorizedDeliveryAtom],
    document_effects: &'a [AuthorizedDocumentEffect],
    projection_effects: &'a [nodex_core_contracts::ProjectionEffect],
    revocations: &'a [ResourceRevocation],
    coverage: &'a DeliveryCoverage,
}

pub(crate) fn resolve(
    connection: &Connection,
    commit_seq: i64,
    request: DeliveryRequest<'_>,
) -> Result<Option<AuthorizedDeliveryPacket>, StoreError> {
    let verified = local_commit::load_verified_commit(connection, commit_seq)?;
    resolve_verified(connection, &verified, request)
}

pub(crate) fn resolve_verified(
    connection: &Connection,
    verified: &local_commit::VerifiedCommit,
    request: DeliveryRequest<'_>,
) -> Result<Option<AuthorizedDeliveryPacket>, StoreError> {
    let manifest = &verified.manifest;
    if manifest.identity.store_epoch.0 != request.context_store_epoch(connection)? {
        return Err(corrupt(
            "Delivery request and CommitManifest Store epoch differ",
        ));
    }
    if !manifest.routing_claims.iter().any(|claim| {
        matches!(
            claim,
            nodex_core_contracts::RoutingClaim::Library { library_id }
                if library_id == &request.context.library_id.0
        )
    }) {
        return Ok(None);
    }

    if request.audience == DeliveryAudience::HostLibraryBroker
        && request.context.adapter != AdapterKind::ElectronHost
    {
        return Err(StoreError::new(
            StoreErrorCode::Unauthorized,
            "Only the Electron Host may request the Library broker delivery audience",
            false,
        ));
    }

    let library_authority = request.audience == DeliveryAudience::HostLibraryBroker
        || (request.context.project_id.is_none()
            && matches!(
                request.context.adapter,
                AdapterKind::ElectronHost | AdapterKind::NativeCli | AdapterKind::Test
            ));
    let project_id = request.context.project_id.as_ref().map(|id| id.0.as_str());
    if !library_authority && project_id.is_none() {
        return Ok(None);
    }
    let authorization_scope = delivery_authorization_scope(request);

    let mut atoms = Vec::new();
    if request.resource_mode != DeliveryResourceMode::ProjectionOnly {
        for atom in &verified.delivery_atoms {
            if request.document_id.is_some_and(|document_id| {
                !atom.descriptor.required_resources.iter().any(|resource| {
                    matches!(
                        resource,
                        ResourceKey::Document {
                            document_id: candidate,
                        } if candidate == document_id
                    )
                })
            }) {
                continue;
            }
            let mut allowed = true;
            for resource in &atom.descriptor.required_resources {
                if !super::resource_authorization::can_read(
                    connection,
                    request.context,
                    &authorization_scope,
                    resource,
                )? {
                    allowed = false;
                    break;
                }
            }
            if allowed {
                atoms.push(AuthorizedDeliveryAtom {
                    descriptor: atom.descriptor.clone(),
                    payload: atom.payload.clone(),
                });
            }
        }
    }

    let mut document_effects = Vec::new();
    if request.resource_mode != DeliveryResourceMode::ProjectionOnly {
        let document_resources = verified.delivery_document_effects(
            connection,
            match request.resource_mode {
                DeliveryResourceMode::RefOnly => LocalCommitResourceMode::RefOnly,
                DeliveryResourceMode::Inline => LocalCommitResourceMode::Inline,
                DeliveryResourceMode::ProjectionOnly => unreachable!(),
            },
        )?;
        for resource in document_resources {
            if request
                .document_id
                .is_some_and(|document_id| document_id != resource.document_id)
            {
                continue;
            }
            let allowed = super::resource_authorization::can_read(
                connection,
                request.context,
                &authorization_scope,
                &ResourceKey::Document {
                    document_id: resource.document_id.clone(),
                },
            )?;
            if !allowed {
                continue;
            }
            document_effects.push(AuthorizedDocumentEffect {
                reference: DocumentEffectRef {
                    effect_order: resource.effect_order,
                    page_id: resource.page_id,
                    document_id: resource.document_id,
                    generation: resource.generation,
                    base_head_seq: resource.base_head_seq,
                    result_head_seq: resource.result_head_seq,
                    update_id: resource.update_id,
                    update_hash: resource.update_hash,
                    update_byte_length: resource.update_byte_length,
                    resource_kind: resource.resource_kind,
                },
                inline_update: resource.inline_update,
            });
        }
    }

    let projection_effects = manifest
        .projection_effects
        .iter()
        .filter(|effect| {
            request.document_id.is_none()
                && (library_authority
                    || project_id.is_some_and(|project_id| {
                        projection_scope_project(&effect.scope.scope) == Some(project_id)
                    }))
        })
        .cloned()
        .collect::<Vec<_>>();
    let revocations = authorized_revocations(manifest, request);
    if atoms.is_empty()
        && document_effects.is_empty()
        && projection_effects.is_empty()
        && revocations.is_empty()
    {
        return Ok(None);
    }

    let coverage = DeliveryCoverage {
        atom_ids: atoms
            .iter()
            .map(|atom| atom.descriptor.atom_id.clone())
            .collect(),
        document_effect_orders: document_effects
            .iter()
            .map(|effect| effect.reference.effect_order)
            .collect(),
        inline_document_effect_orders: document_effects
            .iter()
            .filter(|effect| effect.inline_update.is_some())
            .map(|effect| effect.reference.effect_order)
            .collect(),
        projection_scope_keys: projection_effects
            .iter()
            .map(|effect| effect.scope.canonical_key.clone())
            .collect(),
    };
    let header = CommitManifestHeader {
        event_version: manifest.event_version,
        identity: manifest.identity.clone(),
        operation_id: manifest.operation_id.clone(),
        committed_at: manifest.committed_at.clone(),
    };
    let packet_hash = packet_hash(CanonicalPacket {
        hash_version: 3,
        packet_version: DELIVERY_PACKET_VERSION,
        authorization_scope: &authorization_scope,
        manifest: &header,
        atoms: &atoms,
        document_effects: &document_effects,
        projection_effects: &projection_effects,
        revocations: &revocations,
        coverage: &coverage,
    })?;
    Ok(Some(AuthorizedDeliveryPacket {
        packet_version: DELIVERY_PACKET_VERSION,
        authorization_scope,
        manifest: header,
        atoms,
        document_effects,
        projection_effects,
        revocations,
        coverage,
        packet_hash,
    }))
}

impl DeliveryRequest<'_> {
    fn context_store_epoch(&self, connection: &Connection) -> Result<String, StoreError> {
        connection
            .query_row(
                "SELECT store_epoch FROM block_store_metadata WHERE id = 1",
                [],
                |row| row.get(0),
            )
            .map_err(StoreError::from)
    }
}

fn delivery_authorization_scope(request: DeliveryRequest<'_>) -> DeliveryAuthorizationScope {
    let library_id = request.context.library_id.0.clone();
    if let Some(document_id) = request.document_id {
        return DeliveryAuthorizationScope::Document {
            library_id,
            project_id: request
                .context
                .project_id
                .as_ref()
                .map(|project_id| project_id.0.clone()),
            document_id: document_id.to_owned(),
        };
    }
    if request.audience == DeliveryAudience::HostLibraryBroker {
        return DeliveryAuthorizationScope::Library { library_id };
    }
    match &request.context.project_id {
        Some(project_id) => DeliveryAuthorizationScope::Project {
            library_id,
            project_id: project_id.0.clone(),
        },
        None => DeliveryAuthorizationScope::Library { library_id },
    }
}

fn authorized_revocations(
    manifest: &nodex_core_contracts::CommitManifest,
    request: DeliveryRequest<'_>,
) -> Vec<ResourceRevocation> {
    let library_id = &request.context.library_id.0;
    let project_id = request.context.project_id.as_ref().map(|id| id.0.as_str());
    manifest
        .revocations
        .iter()
        .filter(|revocation| {
            revocation_scope_matches(
                &revocation.authorization_scope,
                library_id,
                project_id,
                request.document_id,
            )
        })
        .cloned()
        .collect()
}

fn revocation_scope_matches(
    scope: &DeliveryAuthorizationScope,
    library_id: &str,
    project_id: Option<&str>,
    document_id: Option<&str>,
) -> bool {
    if let Some(document_id) = document_id {
        return matches!(
            scope,
            DeliveryAuthorizationScope::Document {
                library_id: scope_library_id,
                project_id: scope_project_id,
                document_id: scope_document_id,
            } if scope_library_id == library_id
                && scope_project_id.as_deref() == project_id
                && scope_document_id == document_id
        );
    }
    match scope {
        DeliveryAuthorizationScope::Library {
            library_id: scope_library_id,
        } => scope_library_id == library_id && project_id.is_none(),
        DeliveryAuthorizationScope::Project {
            library_id: scope_library_id,
            project_id: scope_project_id,
        } => {
            scope_library_id == library_id
                && (project_id.is_none() || project_id == Some(scope_project_id.as_str()))
        }
        DeliveryAuthorizationScope::Document {
            library_id: scope_library_id,
            project_id: scope_project_id,
            ..
        } => {
            scope_library_id == library_id
                && (project_id.is_none() || project_id == scope_project_id.as_deref())
        }
    }
}

fn projection_scope_project(scope: &LocalProjectionScope) -> Option<&str> {
    match scope {
        LocalProjectionScope::Library { .. } => None,
        LocalProjectionScope::Project { project_id }
        | LocalProjectionScope::Page { project_id, .. }
        | LocalProjectionScope::DatabaseView { project_id, .. } => Some(project_id),
    }
}

fn packet_hash(packet: CanonicalPacket<'_>) -> Result<String, StoreError> {
    let encoded = serde_json::to_vec(&packet)
        .map_err(|_| corrupt("AuthorizedDeliveryPacket hash input is invalid"))?;
    Ok(format!("{:x}", Sha256::digest(encoded)))
}

fn corrupt(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::StoreCorrupt, message, false)
}

#[cfg(test)]
mod tests {
    use nodex_core_contracts::events::{
        CommitIdentity, CoreModuleEventPayload, DocumentEffectResourceKind,
    };
    use nodex_core_contracts::{StoreEpoch, document::OwnedDocumentEvent};

    use super::*;

    fn header() -> CommitManifestHeader {
        CommitManifestHeader {
            event_version: nodex_core_contracts::CORE_EVENT_VERSION,
            identity: CommitIdentity {
                store_epoch: StoreEpoch("epoch:test".to_owned()),
                commit_seq: 7,
                manifest_hash: "a".repeat(64),
            },
            operation_id: "operation:test".to_owned(),
            committed_at: "2026-08-07T00:00:00Z".to_owned(),
        }
    }

    fn document_effect(inline_update: Option<Vec<u8>>) -> AuthorizedDocumentEffect {
        AuthorizedDocumentEffect {
            reference: DocumentEffectRef {
                effect_order: 0,
                page_id: Some("page:test".to_owned()),
                document_id: "document:test".to_owned(),
                generation: 1,
                base_head_seq: 3,
                result_head_seq: 4,
                update_id: "update:test".to_owned(),
                update_hash: "b".repeat(64),
                update_byte_length: 3,
                resource_kind: DocumentEffectResourceKind::DocumentUpdate,
            },
            inline_update,
        }
    }

    #[test]
    fn document_update_bytes_have_no_delivery_atom() {
        let connection = Connection::open_in_memory().expect("in-memory compiler store");
        let payload = CoreModuleEventPayload::OwnedDocument(OwnedDocumentEvent::DocumentUpdated {
            document_id: "document:test".to_owned(),
            generation: 1,
            head_seq: 4,
            update: vec![1, 2, 3],
        });

        assert!(
            super::super::delivery_atom::compile(
                &connection,
                "library:test",
                "project:test",
                payload,
            )
            .expect("compile document update")
            .is_empty()
        );
    }

    #[test]
    fn inline_coverage_changes_only_the_packet_hash_not_manifest_identity() {
        let manifest = header();
        let reference = vec![document_effect(None)];
        let inline = vec![document_effect(Some(vec![1, 2, 3]))];
        let reference_coverage = DeliveryCoverage {
            atom_ids: Vec::new(),
            document_effect_orders: vec![0],
            inline_document_effect_orders: Vec::new(),
            projection_scope_keys: Vec::new(),
        };
        let inline_coverage = DeliveryCoverage {
            inline_document_effect_orders: vec![0],
            ..reference_coverage.clone()
        };
        let scope = DeliveryAuthorizationScope::Project {
            library_id: "library:test".to_owned(),
            project_id: "project:test".to_owned(),
        };

        let reference_hash = packet_hash(CanonicalPacket {
            hash_version: 3,
            packet_version: DELIVERY_PACKET_VERSION,
            authorization_scope: &scope,
            manifest: &manifest,
            atoms: &[],
            document_effects: &reference,
            projection_effects: &[],
            revocations: &[],
            coverage: &reference_coverage,
        })
        .expect("reference packet hash");
        let inline_hash = packet_hash(CanonicalPacket {
            hash_version: 3,
            packet_version: DELIVERY_PACKET_VERSION,
            authorization_scope: &scope,
            manifest: &manifest,
            atoms: &[],
            document_effects: &inline,
            projection_effects: &[],
            revocations: &[],
            coverage: &inline_coverage,
        })
        .expect("inline packet hash");
        let other_scope = DeliveryAuthorizationScope::Project {
            library_id: "library:test".to_owned(),
            project_id: "project:other".to_owned(),
        };
        let other_scope_hash = packet_hash(CanonicalPacket {
            hash_version: 3,
            packet_version: DELIVERY_PACKET_VERSION,
            authorization_scope: &other_scope,
            manifest: &manifest,
            atoms: &[],
            document_effects: &reference,
            projection_effects: &[],
            revocations: &[],
            coverage: &reference_coverage,
        })
        .expect("other-scope packet hash");

        assert_ne!(reference_hash, inline_hash);
        assert_ne!(reference_hash, other_scope_hash);
        assert_eq!(manifest.identity.manifest_hash, "a".repeat(64));
    }
}
