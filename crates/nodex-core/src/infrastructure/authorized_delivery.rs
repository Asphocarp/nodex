use std::collections::BTreeSet;

use nodex_core_contracts::document::OwnedDocumentEvent;
use nodex_core_contracts::events::{
    AuthorizedDeliveryPacket, AuthorizedDocumentEffect, AuthorizedModuleEffect,
    AuthorizedModulePayload, AuthorizedOwnedDocumentEvent, CommitManifestHeader,
    CoreModuleEventPayload, DeliveryCoverage, DocumentEffectRef, LocalCommitResources,
    LocalProjectionScope, ProjectionImpact, ResourceRevocation, ResourceRevocationReason,
    RevokedResourceKind, SemanticEffect,
};
use nodex_core_contracts::{AdapterKind, BoundModuleContext};
use rusqlite::{Connection, OptionalExtension, params};
use serde::Serialize;
use sha2::{Digest, Sha256};

use super::event_log::load_committed_event_by_sequence;
use super::local_commit::{self, LocalCommitResourceMode};
use super::projection_impact::canonicalize;
use super::sqlite::{StoreError, StoreErrorCode};

const DELIVERY_PACKET_VERSION: u32 = 1;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum DeliveryResourceMode {
    RefOnly,
    Inline,
}

#[derive(Clone, Copy, Debug)]
pub(crate) struct DeliveryRequest<'a> {
    pub context: &'a BoundModuleContext,
    pub document_id: Option<&'a str>,
    pub resource_mode: DeliveryResourceMode,
}

#[derive(Serialize)]
struct CanonicalPacket<'a> {
    hash_version: u32,
    packet_version: u32,
    manifest: &'a CommitManifestHeader,
    effects: &'a [AuthorizedModuleEffect],
    document_effects: &'a [AuthorizedDocumentEffect],
    projection_effects: &'a [nodex_core_contracts::ProjectionEffect],
    revocations: &'a [ResourceRevocation],
    projection_impact: &'a ProjectionImpact,
    coverage: &'a DeliveryCoverage,
}

pub(crate) fn resolve(
    connection: &Connection,
    commit_seq: i64,
    request: DeliveryRequest<'_>,
) -> Result<Option<AuthorizedDeliveryPacket>, StoreError> {
    let verified = local_commit::load_verified_commit(connection, commit_seq)?;
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

    let library_authority = request.context.project_id.is_none()
        && matches!(
            request.context.adapter,
            AdapterKind::ElectronHost | AdapterKind::NativeCli | AdapterKind::Test
        );
    let project_id = request.context.project_id.as_ref().map(|id| id.0.as_str());
    if !library_authority && project_id.is_none() {
        return Ok(None);
    }

    let mut effects = Vec::new();
    let mut projection_impact = ProjectionImpact::None;
    let mut revocations = BTreeSet::<(RevokedResourceKind, String)>::new();
    for physical in &verified.physical_effects {
        let (effect_order, change_log_seq, physical_project_id, _, _, _, resources, _, _) =
            physical;
        if request.document_id.is_some_and(|document_id| {
            !resources
                .document_ids
                .iter()
                .any(|candidate| candidate == document_id)
        }) {
            continue;
        }
        let semantic = manifest
            .semantic_effects
            .iter()
            .find(|effect| effect.effect_order() == *effect_order)
            .ok_or_else(|| corrupt("CommitManifest semantic effect index is incomplete"))?;
        let allowed = match project_id {
            Some(_) if !library_authority => {
                effect_is_authorized(connection, request.context, physical_project_id, resources)?
            }
            _ => library_authority,
        };
        if !allowed {
            if project_id == Some(physical_project_id.as_str()) {
                add_resource_revocations(
                    connection,
                    &request.context.library_id.0,
                    resources,
                    request.document_id,
                    &mut revocations,
                )?;
            }
            continue;
        }
        let event = load_committed_event_by_sequence(connection, *change_log_seq)?;
        if request
            .document_id
            .is_some_and(|document_id| owned_document_event_id(&event.payload) != Some(document_id))
        {
            continue;
        }
        projection_impact = local_commit::merge_projection_impact(
            projection_impact,
            semantic_projection_impact(semantic).clone(),
        )?;
        if let Some(payload) = authorized_payload(event.payload) {
            effects.push(AuthorizedModuleEffect {
                semantic: semantic.clone(),
                payload,
            });
        }
    }

    let document_resources = verified.delivery_document_effects(
        connection,
        match request.resource_mode {
            DeliveryResourceMode::RefOnly => LocalCommitResourceMode::RefOnly,
            DeliveryResourceMode::Inline => LocalCommitResourceMode::Inline,
        },
    )?;
    let mut document_effects = Vec::new();
    for resource in document_resources {
        if request
            .document_id
            .is_some_and(|document_id| document_id != resource.document_id)
        {
            continue;
        }
        let allowed = match project_id {
            Some(_) if !library_authority => {
                document_is_authorized(connection, request.context, &resource.document_id)?
            }
            _ => library_authority,
        };
        if !allowed {
            if project_id == Some(resource.project_id.as_str()) {
                revocations.insert((RevokedResourceKind::Document, resource.document_id.clone()));
                if request.document_id.is_none()
                    && let Some(page_id) = resource.page_id
                {
                    revocations.insert((RevokedResourceKind::Page, page_id));
                }
            }
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
    let revocations = revocations
        .into_iter()
        .map(|(resource_kind, resource_id)| ResourceRevocation {
            resource_kind,
            resource_id,
            reason: ResourceRevocationReason::OwnershipMoved,
        })
        .collect::<Vec<_>>();
    if effects.is_empty()
        && document_effects.is_empty()
        && projection_effects.is_empty()
        && revocations.is_empty()
    {
        return Ok(None);
    }

    let coverage = DeliveryCoverage {
        semantic_effect_orders: effects
            .iter()
            .map(|effect| effect.semantic.effect_order())
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
    let projection_impact = canonicalize(projection_impact)?;
    let packet_hash = packet_hash(
        &header,
        &effects,
        &document_effects,
        &projection_effects,
        &revocations,
        &projection_impact,
        &coverage,
    )?;
    Ok(Some(AuthorizedDeliveryPacket {
        packet_version: DELIVERY_PACKET_VERSION,
        manifest: header,
        effects,
        document_effects,
        projection_effects,
        revocations,
        projection_impact,
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

fn effect_is_authorized(
    connection: &Connection,
    context: &BoundModuleContext,
    physical_project_id: &str,
    resources: &LocalCommitResources,
) -> Result<bool, StoreError> {
    let project_id = context
        .project_id
        .as_ref()
        .map(|project_id| project_id.0.as_str())
        .ok_or_else(|| corrupt("Project delivery context is missing its Project"))?;
    for block_id in &resources.block_ids {
        if page_is_authorized(connection, &context.library_id.0, project_id, block_id)? {
            return Ok(true);
        }
    }
    for document_id in &resources.document_ids {
        if document_is_authorized(connection, context, document_id)? {
            return Ok(true);
        }
    }
    for database_id in &resources.database_ids {
        if database_is_authorized(connection, project_id, database_id)? {
            return Ok(true);
        }
    }
    Ok(physical_project_id == project_id
        && resources.block_ids.is_empty()
        && resources.database_ids.is_empty())
}

fn page_is_authorized(
    connection: &Connection,
    library_id: &str,
    project_id: &str,
    page_id: &str,
) -> Result<bool, StoreError> {
    let is_page = connection
        .query_row(
            "SELECT 1 FROM pages WHERE block_id = ?1 AND library_id = ?2",
            params![page_id, library_id],
            |_| Ok(()),
        )
        .optional()?
        .is_some();
    if !is_page {
        return Ok(false);
    }
    Ok(
        crate::library::require_page_read_access(connection, library_id, project_id, page_id)
            .is_ok(),
    )
}

fn database_is_authorized(
    connection: &Connection,
    project_id: &str,
    database_id: &str,
) -> Result<bool, StoreError> {
    let authorized = connection.query_row(
        "SELECT EXISTS(
           SELECT 1 FROM projects project
           WHERE project.id = ?1 AND project.database_block_id = ?2
         ) OR EXISTS(
           SELECT 1 FROM project_resource_grants grant
           WHERE grant.project_id = ?1 AND grant.root_kind = 'database'
             AND grant.root_id = ?2 AND grant.lifecycle = 'active'
         )",
        params![project_id, database_id],
        |row| row.get::<_, i64>(0),
    )?;
    Ok(authorized == 1)
}

fn document_is_authorized(
    connection: &Connection,
    context: &BoundModuleContext,
    document_id: &str,
) -> Result<bool, StoreError> {
    match crate::document::require_owned_document_read_access(connection, context, document_id) {
        Ok(()) => Ok(true),
        Err(error)
            if matches!(
                error.code,
                StoreErrorCode::NotFound | StoreErrorCode::Unauthorized
            ) =>
        {
            Ok(false)
        }
        Err(error) => Err(error),
    }
}

fn add_resource_revocations(
    connection: &Connection,
    library_id: &str,
    resources: &LocalCommitResources,
    requested_document_id: Option<&str>,
    revocations: &mut BTreeSet<(RevokedResourceKind, String)>,
) -> Result<(), StoreError> {
    if let Some(document_id) = requested_document_id {
        if resources
            .document_ids
            .iter()
            .any(|candidate| candidate == document_id)
        {
            revocations.insert((RevokedResourceKind::Document, document_id.to_owned()));
        }
        return Ok(());
    }
    for block_id in &resources.block_ids {
        let is_page = connection
            .query_row(
                "SELECT 1 FROM pages WHERE block_id = ?1 AND library_id = ?2",
                params![block_id, library_id],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        if is_page {
            revocations.insert((RevokedResourceKind::Page, block_id.clone()));
        }
    }
    revocations.extend(
        resources
            .document_ids
            .iter()
            .cloned()
            .map(|document_id| (RevokedResourceKind::Document, document_id)),
    );
    Ok(())
}

fn owned_document_event_id(payload: &CoreModuleEventPayload) -> Option<&str> {
    match payload {
        CoreModuleEventPayload::OwnedDocument(OwnedDocumentEvent::DocumentUpdated {
            document_id,
            ..
        })
        | CoreModuleEventPayload::OwnedDocument(OwnedDocumentEvent::DocumentResyncRequired {
            document_id,
            ..
        })
        | CoreModuleEventPayload::OwnedDocument(OwnedDocumentEvent::CanvasUpdated {
            document_id,
            ..
        })
        | CoreModuleEventPayload::OwnedDocument(OwnedDocumentEvent::CanvasGenerationChanged {
            document_id,
            ..
        })
        | CoreModuleEventPayload::OwnedDocument(OwnedDocumentEvent::DocumentInvalidated {
            document_id,
            ..
        }) => Some(document_id),
        _ => None,
    }
}

fn semantic_projection_impact(effect: &SemanticEffect) -> &ProjectionImpact {
    match effect {
        SemanticEffect::ModuleChanged {
            projection_impact, ..
        } => projection_impact,
    }
}

fn authorized_payload(payload: CoreModuleEventPayload) -> Option<AuthorizedModulePayload> {
    match payload {
        CoreModuleEventPayload::Library(event) => Some(AuthorizedModulePayload::Library(event)),
        CoreModuleEventPayload::Database(event) => Some(AuthorizedModulePayload::Database(event)),
        CoreModuleEventPayload::ProjectWorkspace(event) => {
            Some(AuthorizedModulePayload::ProjectWorkspace(event))
        }
        CoreModuleEventPayload::Automation(event) => {
            Some(AuthorizedModulePayload::Automation(event))
        }
        CoreModuleEventPayload::StoreAdministration(event) => {
            Some(AuthorizedModulePayload::StoreAdministration(event))
        }
        CoreModuleEventPayload::OwnedDocument(OwnedDocumentEvent::DocumentUpdated { .. }) => None,
        CoreModuleEventPayload::OwnedDocument(OwnedDocumentEvent::DocumentResyncRequired {
            document_id,
            generation,
            head_seq,
            update_id,
            update_hash,
        }) => Some(AuthorizedModulePayload::OwnedDocument(
            AuthorizedOwnedDocumentEvent::DocumentResyncRequired {
                document_id,
                generation,
                head_seq,
                update_id,
                update_hash,
            },
        )),
        CoreModuleEventPayload::OwnedDocument(OwnedDocumentEvent::CanvasUpdated {
            document_id,
            generation,
            base_head_seq,
            head_seq,
            scene_hash,
            mutation,
        }) => Some(AuthorizedModulePayload::OwnedDocument(
            AuthorizedOwnedDocumentEvent::CanvasUpdated {
                document_id,
                generation,
                base_head_seq,
                head_seq,
                scene_hash,
                mutation,
            },
        )),
        CoreModuleEventPayload::OwnedDocument(OwnedDocumentEvent::CanvasGenerationChanged {
            document_id,
            previous_generation,
            previous_head_seq,
            generation,
            head_seq,
            scene_hash,
        }) => Some(AuthorizedModulePayload::OwnedDocument(
            AuthorizedOwnedDocumentEvent::CanvasGenerationChanged {
                document_id,
                previous_generation,
                previous_head_seq,
                generation,
                head_seq,
                scene_hash,
            },
        )),
        CoreModuleEventPayload::OwnedDocument(OwnedDocumentEvent::DocumentInvalidated {
            document_id,
            reason,
        }) => Some(AuthorizedModulePayload::OwnedDocument(
            AuthorizedOwnedDocumentEvent::DocumentInvalidated {
                document_id,
                reason,
            },
        )),
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

fn packet_hash(
    manifest: &CommitManifestHeader,
    effects: &[AuthorizedModuleEffect],
    document_effects: &[AuthorizedDocumentEffect],
    projection_effects: &[nodex_core_contracts::ProjectionEffect],
    revocations: &[ResourceRevocation],
    projection_impact: &ProjectionImpact,
    coverage: &DeliveryCoverage,
) -> Result<String, StoreError> {
    let encoded = serde_json::to_vec(&CanonicalPacket {
        hash_version: 1,
        packet_version: DELIVERY_PACKET_VERSION,
        manifest,
        effects,
        document_effects,
        projection_effects,
        revocations,
        projection_impact,
        coverage,
    })
    .map_err(|_| corrupt("AuthorizedDeliveryPacket hash input is invalid"))?;
    Ok(format!("{:x}", Sha256::digest(encoded)))
}

fn corrupt(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::StoreCorrupt, message, false)
}

#[cfg(test)]
mod tests {
    use nodex_core_contracts::events::{
        CommitIdentity, DocumentEffectResourceKind, ProjectionImpact,
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
    fn document_update_bytes_have_no_authorized_module_payload_variant() {
        let payload = CoreModuleEventPayload::OwnedDocument(OwnedDocumentEvent::DocumentUpdated {
            document_id: "document:test".to_owned(),
            generation: 1,
            head_seq: 4,
            update: vec![1, 2, 3],
        });

        assert_eq!(authorized_payload(payload), None);
    }

    #[test]
    fn inline_coverage_changes_only_the_packet_hash_not_manifest_identity() {
        let manifest = header();
        let reference = vec![document_effect(None)];
        let inline = vec![document_effect(Some(vec![1, 2, 3]))];
        let reference_coverage = DeliveryCoverage {
            semantic_effect_orders: Vec::new(),
            document_effect_orders: vec![0],
            inline_document_effect_orders: Vec::new(),
            projection_scope_keys: Vec::new(),
        };
        let inline_coverage = DeliveryCoverage {
            inline_document_effect_orders: vec![0],
            ..reference_coverage.clone()
        };

        let reference_hash = packet_hash(
            &manifest,
            &[],
            &reference,
            &[],
            &[],
            &ProjectionImpact::None,
            &reference_coverage,
        )
        .expect("reference packet hash");
        let inline_hash = packet_hash(
            &manifest,
            &[],
            &inline,
            &[],
            &[],
            &ProjectionImpact::None,
            &inline_coverage,
        )
        .expect("inline packet hash");

        assert_ne!(reference_hash, inline_hash);
        assert_eq!(manifest.identity.manifest_hash, "a".repeat(64));
    }
}
