//! The single lifecycle authority for semantic durable mutations.
//!
//! Domain modules own validation and canonical writes. This module owns the
//! cross-domain invariants that make those writes one replayable commit:
//! operation identity, receipt persistence, manifest sealing, and no-op
//! abandonment. Callers cannot successfully return a partially finalized
//! semantic commit.

use std::cell::RefCell;
use std::collections::BTreeSet;
use std::marker::PhantomData;

use nodex_core_contracts::events::{
    CommitManifest, DeliveryAuthorizationScope, RevokedResourceKind,
};
use nodex_core_contracts::{ApplyResponse, BoundModuleContext, ModuleName, StoreObservation};
use rusqlite::Connection;
use serde::Serialize;
use serde::de::DeserializeOwned;

use super::local_commit::{self, CommitContext};
use super::module_receipts::{
    NewModuleReceipt, StoredModuleReceipt, insert_module_receipt, read_module_receipt,
};
use super::sqlite::{StoreError, StoreErrorCode};

#[derive(Clone, Copy)]
pub(crate) struct OperationIdentity<'a> {
    pub module: ModuleName,
    pub module_name: &'a str,
    pub operation_id: &'a str,
    pub intent_hash: &'a str,
    pub store_epoch: &'a str,
    pub committed_at: &'a str,
    pub context: &'a BoundModuleContext,
}

#[derive(Clone, Copy)]
pub(crate) struct ReceiptMetadata<'a> {
    pub operation_kind: &'a str,
    pub event_sequence: Option<i64>,
    pub committed_at: &'a str,
}

/// A transaction-scoped capability. It deliberately exposes neither commit
/// allocation nor finalization. Domain repositories may borrow the physical
/// evidence token while they perform their own canonical writes.
pub(crate) struct DurableMutationScope<'connection> {
    connection: &'connection Connection,
    context: CommitContext,
    module: ModuleName,
    authorization_before: RefCell<BTreeSet<AuthorizedResourceObservation>>,
}

/// A resource that was visible through one exact authorization scope before a
/// mutation began. Domain writers record these observations before changing
/// ownership or grants; their sealer compares them with canonical post-state
/// authorization and persists only real losses into the LocalCommit.
#[derive(Clone, Debug, Eq, Ord, PartialEq, PartialOrd)]
pub(crate) struct AuthorizedResourceObservation {
    pub authorization_scope: DeliveryAuthorizationScope,
    pub resource_kind: RevokedResourceKind,
    pub resource_id: String,
}

/// Type-state token for complex/prepared writers whose control flow cannot be
/// expressed as one small closure. It is still allocated and consumed only by
/// this module; dropping it without returning an error leaves an open ledger
/// parent that makes the enclosing transaction fail its domain checks/tests.
pub(crate) struct PreparedDurableMutation<'connection> {
    scope: DurableMutationScope<'connection>,
    module_name: String,
    operation_id: String,
    intent_hash: String,
    store_epoch: String,
    context: BoundModuleContext,
}

impl PreparedDurableMutation<'_> {
    pub(crate) fn evidence(&self) -> &CommitContext {
        self.scope.evidence()
    }

    pub(crate) fn commit_seq(&self) -> i64 {
        self.scope.commit_seq()
    }

    pub(crate) fn committed_at(&self) -> &str {
        self.scope.context.committed_at()
    }

    pub(crate) fn observe_authorization_before(
        &self,
        observations: impl IntoIterator<Item = AuthorizedResourceObservation>,
    ) {
        self.scope.observe_authorization_before(observations);
    }
}

impl<'connection> DurableMutationScope<'connection> {
    pub(crate) fn connection(&self) -> &'connection Connection {
        self.connection
    }

    pub(crate) fn evidence(&self) -> &CommitContext {
        &self.context
    }

    pub(crate) fn commit_seq(&self) -> i64 {
        self.context.commit_seq()
    }

    pub(crate) fn store_epoch(&self) -> &str {
        self.context.store_epoch()
    }

    pub(crate) fn observe_authorization_before(
        &self,
        observations: impl IntoIterator<Item = AuthorizedResourceObservation>,
    ) {
        self.authorization_before.borrow_mut().extend(observations);
    }

    pub(crate) fn authorization_before(&self) -> Vec<AuthorizedResourceObservation> {
        self.authorization_before.borrow().iter().cloned().collect()
    }

    pub(crate) fn seal<T>(&self, outcome: T, receipt: ReceiptMetadata<'_>) -> SealedOutcome<T> {
        SealedOutcome {
            outcome,
            receipt: OwnedReceiptMetadata {
                operation_kind: receipt.operation_kind.to_owned(),
                event_sequence: receipt.event_sequence,
                committed_at: receipt.committed_at.to_owned(),
            },
            disposition: Disposition::Commit,
            module: self.module,
            _sealed: PhantomData,
        }
    }

    pub(crate) fn no_op<T>(&self, outcome: T, receipt: ReceiptMetadata<'_>) -> SealedOutcome<T> {
        SealedOutcome {
            outcome,
            receipt: OwnedReceiptMetadata {
                operation_kind: receipt.operation_kind.to_owned(),
                event_sequence: receipt.event_sequence,
                committed_at: receipt.committed_at.to_owned(),
            },
            disposition: Disposition::NoOp,
            module: self.module,
            _sealed: PhantomData,
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Disposition {
    Commit,
    NoOp,
}

struct OwnedReceiptMetadata {
    operation_kind: String,
    event_sequence: Option<i64>,
    committed_at: String,
}

/// Only `DurableMutationScope` can construct this value. Returning ordinary
/// `T` from a mutation closure is therefore insufficient to commit.
pub(crate) struct SealedOutcome<T> {
    outcome: T,
    receipt: OwnedReceiptMetadata,
    disposition: Disposition,
    module: ModuleName,
    _sealed: PhantomData<fn() -> T>,
}

impl<T> SealedOutcome<T> {
    pub(crate) fn into_outcome(self) -> T {
        self.outcome
    }
}

#[derive(Debug)]
pub(crate) enum CommitResult<T> {
    Committed {
        outcome: T,
        manifest: CommitManifest,
    },
    IdempotentReplay {
        outcome: T,
        manifest: Option<CommitManifest>,
    },
    NoOp {
        outcome: T,
    },
}

impl<T> CommitResult<T> {
    pub(crate) fn verify_manifest_identity(
        &self,
        identity: impl FnOnce(&T) -> (i64, String),
    ) -> Result<(), StoreError> {
        let (outcome, manifest) = match self {
            Self::Committed { outcome, manifest } => (outcome, Some(manifest)),
            Self::IdempotentReplay { outcome, manifest } => (outcome, manifest.as_ref()),
            Self::NoOp { .. } => return Ok(()),
        };
        let Some(manifest) = manifest else {
            return Err(corrupt(
                "Committed durable mutation receipt has no manifest",
            ));
        };
        let (commit_seq, store_epoch) = identity(outcome);
        if manifest.identity.commit_seq == commit_seq
            && manifest.identity.store_epoch.0 == store_epoch
        {
            return Ok(());
        }
        Err(corrupt(
            "Durable mutation outcome and manifest identity diverge",
        ))
    }
}

pub(crate) fn run<T>(
    connection: &Connection,
    identity: OperationIdentity<'_>,
    apply: impl FnOnce(&DurableMutationScope<'_>) -> Result<SealedOutcome<T>, StoreError>,
) -> Result<CommitResult<T>, StoreError>
where
    T: DeserializeOwned + Serialize,
{
    validate_module_identity(identity)?;
    if let Some(stored) =
        read_module_receipt(connection, identity.module_name, identity.operation_id)?
    {
        return replay(connection, identity, stored);
    }

    let context = local_commit::begin(
        connection,
        identity.store_epoch,
        identity.operation_id,
        identity.intent_hash,
        identity.committed_at,
    )?;
    let scope = DurableMutationScope {
        connection,
        context,
        module: identity.module,
        authorization_before: RefCell::new(BTreeSet::new()),
    };
    let sealed = apply(&scope)?;
    if sealed.module != identity.module {
        return Err(corrupt(
            "Durable mutation outcome changed its owning Module",
        ));
    }
    if sealed.receipt.committed_at != identity.committed_at {
        return Err(corrupt(
            "Durable mutation receipt timestamp diverges from its identity",
        ));
    }
    if sealed.disposition == Disposition::NoOp && sealed.receipt.event_sequence.is_some() {
        return Err(corrupt(
            "Durable mutation no-op references a physical event",
        ));
    }

    let encoded = serde_json::to_value(&sealed.outcome)
        .map_err(|_| internal("Durable mutation outcome could not be encoded"))?;
    match sealed.disposition {
        Disposition::Commit => {
            insert_module_receipt(
                connection,
                NewModuleReceipt {
                    module_name: identity.module_name,
                    operation_id: identity.operation_id,
                    context: identity.context,
                    operation_kind: &sealed.receipt.operation_kind,
                    store_epoch: identity.store_epoch,
                    request_hash: identity.intent_hash,
                    result: &encoded,
                    event_sequence: sealed.receipt.event_sequence,
                    local_commit: Some(&scope.context),
                    committed_at: &sealed.receipt.committed_at,
                },
            )?;
            let commit_seq = local_commit::finalize(connection, &scope.context)?;
            let manifest = local_commit::read_manifest(connection, commit_seq)?;
            Ok(CommitResult::Committed {
                outcome: sealed.outcome,
                manifest,
            })
        }
        Disposition::NoOp => {
            local_commit::abandon(connection, &scope.context)?;
            insert_module_receipt(
                connection,
                NewModuleReceipt {
                    module_name: identity.module_name,
                    operation_id: identity.operation_id,
                    context: identity.context,
                    operation_kind: &sealed.receipt.operation_kind,
                    store_epoch: identity.store_epoch,
                    request_hash: identity.intent_hash,
                    result: &encoded,
                    event_sequence: None,
                    local_commit: None,
                    committed_at: &sealed.receipt.committed_at,
                },
            )?;
            Ok(CommitResult::NoOp {
                outcome: sealed.outcome,
            })
        }
    }
}

pub(crate) fn prepare<'connection>(
    connection: &'connection Connection,
    identity: OperationIdentity<'_>,
) -> Result<PreparedDurableMutation<'connection>, StoreError> {
    validate_module_identity(identity)?;
    if read_module_receipt(connection, identity.module_name, identity.operation_id)?.is_some() {
        return Err(StoreError::new(
            StoreErrorCode::IdempotencyKeyReused,
            "operation_id already has a durable mutation receipt",
            false,
        ));
    }
    let context = local_commit::begin(
        connection,
        identity.store_epoch,
        identity.operation_id,
        identity.intent_hash,
        identity.committed_at,
    )?;
    Ok(PreparedDurableMutation {
        scope: DurableMutationScope {
            connection,
            context,
            module: identity.module,
            authorization_before: RefCell::new(BTreeSet::new()),
        },
        module_name: identity.module_name.to_owned(),
        operation_id: identity.operation_id.to_owned(),
        intent_hash: identity.intent_hash.to_owned(),
        store_epoch: identity.store_epoch.to_owned(),
        context: identity.context.clone(),
    })
}

pub(crate) fn finish_prepared<T: Serialize>(
    prepared: PreparedDurableMutation<'_>,
    outcome: &T,
    receipt: ReceiptMetadata<'_>,
) -> Result<CommitManifest, StoreError> {
    if receipt.committed_at != prepared.committed_at() {
        return Err(corrupt(
            "Prepared durable mutation receipt timestamp diverges from its identity",
        ));
    }
    let encoded = serde_json::to_value(outcome)
        .map_err(|_| internal("Prepared durable mutation outcome could not be encoded"))?;
    insert_module_receipt(
        prepared.scope.connection,
        NewModuleReceipt {
            module_name: &prepared.module_name,
            operation_id: &prepared.operation_id,
            context: &prepared.context,
            operation_kind: receipt.operation_kind,
            store_epoch: &prepared.store_epoch,
            request_hash: &prepared.intent_hash,
            result: &encoded,
            event_sequence: receipt.event_sequence,
            local_commit: Some(&prepared.scope.context),
            committed_at: receipt.committed_at,
        },
    )?;
    let commit_seq = local_commit::finalize(prepared.scope.connection, &prepared.scope.context)?;
    local_commit::read_manifest(prepared.scope.connection, commit_seq)
}

pub(crate) fn run_prepared<T>(
    prepared: PreparedDurableMutation<'_>,
    apply: impl FnOnce(&DurableMutationScope<'_>) -> Result<SealedOutcome<T>, StoreError>,
) -> Result<CommitResult<T>, StoreError>
where
    T: Serialize,
{
    let sealed = apply(&prepared.scope)?;
    if sealed.module != prepared.scope.module {
        return Err(corrupt(
            "Durable mutation outcome changed its owning Module",
        ));
    }
    if sealed.receipt.committed_at != prepared.committed_at() {
        return Err(corrupt(
            "Prepared durable mutation receipt timestamp diverges from its identity",
        ));
    }
    if sealed.disposition == Disposition::NoOp && sealed.receipt.event_sequence.is_some() {
        return Err(corrupt(
            "Durable mutation no-op references a physical event",
        ));
    }
    let encoded = serde_json::to_value(&sealed.outcome)
        .map_err(|_| internal("Prepared durable mutation outcome could not be encoded"))?;
    match sealed.disposition {
        Disposition::Commit => {
            insert_module_receipt(
                prepared.scope.connection,
                NewModuleReceipt {
                    module_name: &prepared.module_name,
                    operation_id: &prepared.operation_id,
                    context: &prepared.context,
                    operation_kind: &sealed.receipt.operation_kind,
                    store_epoch: &prepared.store_epoch,
                    request_hash: &prepared.intent_hash,
                    result: &encoded,
                    event_sequence: sealed.receipt.event_sequence,
                    local_commit: Some(&prepared.scope.context),
                    committed_at: &sealed.receipt.committed_at,
                },
            )?;
            let commit_seq =
                local_commit::finalize(prepared.scope.connection, &prepared.scope.context)?;
            let manifest = local_commit::read_manifest(prepared.scope.connection, commit_seq)?;
            Ok(CommitResult::Committed {
                outcome: sealed.outcome,
                manifest,
            })
        }
        Disposition::NoOp => {
            local_commit::abandon(prepared.scope.connection, &prepared.scope.context)?;
            insert_module_receipt(
                prepared.scope.connection,
                NewModuleReceipt {
                    module_name: &prepared.module_name,
                    operation_id: &prepared.operation_id,
                    context: &prepared.context,
                    operation_kind: &sealed.receipt.operation_kind,
                    store_epoch: &prepared.store_epoch,
                    request_hash: &prepared.intent_hash,
                    result: &encoded,
                    event_sequence: None,
                    local_commit: None,
                    committed_at: &sealed.receipt.committed_at,
                },
            )?;
            Ok(CommitResult::NoOp {
                outcome: sealed.outcome,
            })
        }
    }
}

pub(crate) fn record_no_op<T: Serialize>(
    connection: &Connection,
    identity: OperationIdentity<'_>,
    outcome: &T,
    receipt: ReceiptMetadata<'_>,
) -> Result<(), StoreError> {
    if receipt.event_sequence.is_some() || receipt.committed_at != identity.committed_at {
        return Err(corrupt("Durable mutation no-op receipt is inconsistent"));
    }
    validate_module_identity(identity)?;
    let context = local_commit::begin(
        connection,
        identity.store_epoch,
        identity.operation_id,
        identity.intent_hash,
        identity.committed_at,
    )?;
    local_commit::abandon(connection, &context)?;
    let encoded = serde_json::to_value(outcome)
        .map_err(|_| internal("Durable mutation no-op outcome could not be encoded"))?;
    insert_module_receipt(
        connection,
        NewModuleReceipt {
            module_name: identity.module_name,
            operation_id: identity.operation_id,
            context: identity.context,
            operation_kind: receipt.operation_kind,
            store_epoch: identity.store_epoch,
            request_hash: identity.intent_hash,
            result: &encoded,
            event_sequence: None,
            local_commit: None,
            committed_at: receipt.committed_at,
        },
    )
}

fn replay<T>(
    connection: &Connection,
    identity: OperationIdentity<'_>,
    stored: StoredModuleReceipt,
) -> Result<CommitResult<T>, StoreError>
where
    T: DeserializeOwned,
{
    if stored.store_epoch != identity.store_epoch || stored.request_hash != identity.intent_hash {
        return Err(StoreError::new(
            StoreErrorCode::IdempotencyKeyReused,
            "operation_id is already bound to another durable mutation intent",
            false,
        ));
    }
    let outcome = serde_json::from_value(stored.result)
        .map_err(|_| corrupt("Stored durable mutation outcome is invalid"))?;
    let manifest = stored
        .local_commit_seq
        .map(|commit_seq| local_commit::read_manifest(connection, commit_seq))
        .transpose()?;
    Ok(CommitResult::IdempotentReplay { outcome, manifest })
}

/// Converts the private writer result stored in a module receipt into the
/// closed public command result used by preparation replay endpoints. Delivery
/// remains absent here because preparation is a read; the apply fast path and
/// durable stream resolve post-state authorization independently.
pub(crate) fn replay_apply_response<T, R>(
    connection: &Connection,
    local_commit_seq: Option<i64>,
    committed: crate::ModuleWriterResult<T, R>,
) -> Result<ApplyResponse<T, R>, StoreError> {
    let crate::ModuleWriterResult {
        value: outcome,
        receipt,
        commit_seq: observed_commit_head,
        store_epoch,
        ..
    } = committed;
    let Some(commit_seq) = local_commit_seq else {
        return Ok(ApplyResponse::NoOp {
            outcome,
            receipt,
            observed: StoreObservation {
                store_epoch,
                commit_head: observed_commit_head,
            },
        });
    };
    let commit = local_commit::read_manifest(connection, commit_seq)?.identity;
    if commit.commit_seq != observed_commit_head || commit.store_epoch != store_epoch {
        return Err(corrupt(
            "Stored command replay diverges from its manifest identity",
        ));
    }
    Ok(ApplyResponse::Committed {
        outcome,
        receipt,
        commit,
        delivery: None,
    })
}

fn validate_module_identity(identity: OperationIdentity<'_>) -> Result<(), StoreError> {
    if module_name(identity.module) != identity.module_name {
        return Err(corrupt(
            "Durable mutation Module enum and storage identity diverge",
        ));
    }
    Ok(())
}

fn module_name(module: ModuleName) -> &'static str {
    match module {
        ModuleName::Library => "library",
        ModuleName::Database => "database",
        ModuleName::OwnedDocument => "owned_document",
        ModuleName::ProjectWorkspace => "project_workspace",
        ModuleName::Automation => "automation",
        ModuleName::StoreAdministration => "store_administration",
    }
}

fn corrupt(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::StoreCorrupt, message, false)
}

fn internal(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::Internal, message, false)
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use nodex_core_contracts::{AdapterKind, LibraryId, ProfileId, ProjectId, ProjectionImpact};
    use rusqlite::OptionalExtension;
    use serde::{Deserialize, Serialize};
    use serde_json::json;
    use tempfile::tempdir;

    use super::*;
    use crate::infrastructure::event_log::{NewChangeLogEntry, append_change_log};
    use crate::infrastructure::sqlite::with_immediate_transaction;
    use crate::infrastructure::store::SqliteStoreKernel;

    #[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
    struct TestOutcome {
        operation_id: String,
        commit_seq: i64,
    }

    fn context() -> BoundModuleContext {
        BoundModuleContext {
            profile_id: ProfileId("profile:durable-mutation".to_owned()),
            library_id: LibraryId("library:durable-mutation".to_owned()),
            project_id: Some(ProjectId("project:durable-mutation".to_owned())),
            connection_id: "connection:durable-mutation".to_owned(),
            adapter: AdapterKind::Test,
        }
    }

    fn seed(connection: &Connection) -> Result<String, StoreError> {
        let store_epoch = connection
            .query_row(
                "SELECT store_epoch FROM block_store_metadata WHERE id = 1",
                [],
                |row| row.get::<_, String>(0),
            )
            .optional()?
            .unwrap_or_else(|| "epoch:durable-mutation".to_owned());
        connection.execute(
            "INSERT OR IGNORE INTO block_store_metadata(
               id, store_epoch, created_at, updated_at
             ) VALUES (1, ?1, '2026-08-07', '2026-08-07')",
            [&store_epoch],
        )?;
        connection.execute_batch(
            "INSERT INTO profiles(id, created_at, updated_at)
             VALUES ('profile:durable-mutation', '2026-08-07', '2026-08-07');
             INSERT INTO libraries(id, profile_id, created_at, updated_at)
             VALUES (
               'library:durable-mutation', 'profile:durable-mutation',
               '2026-08-07', '2026-08-07'
             );
             INSERT INTO projects(id, library_id, name, created, updated)
             VALUES (
               'project:durable-mutation', 'library:durable-mutation',
               'Durable mutation', '2026-08-07', '2026-08-07'
             );",
        )?;
        Ok(store_epoch)
    }

    fn apply_test_mutation(
        connection: &Connection,
        context: &BoundModuleContext,
        store_epoch: &str,
        operation_id: &str,
        intent_hash: &str,
        executions: &AtomicUsize,
    ) -> Result<CommitResult<TestOutcome>, StoreError> {
        run(
            connection,
            OperationIdentity {
                module: ModuleName::Database,
                module_name: "database",
                operation_id,
                intent_hash,
                store_epoch,
                committed_at: "2026-08-07T00:00:00Z",
                context,
            },
            |scope| {
                executions.fetch_add(1, Ordering::SeqCst);
                let payload = json!({
                    "module": "database",
                    "operationId": operation_id,
                });
                let payload_json = serde_json::to_string(&payload)
                    .map_err(|_| internal("test payload encoding"))?;
                let event_sequence = append_change_log(
                    scope.connection(),
                    NewChangeLogEntry {
                        project_id: "project:durable-mutation",
                        store_epoch,
                        kind: "database.changed",
                        operation_id: Some(operation_id),
                        block_ids: &[],
                        document_ids: &[],
                        database_block_ids: &[],
                        payload_json: &payload_json,
                        projection_impact: &ProjectionImpact::None,
                        committed_at: "2026-08-07T00:00:00Z",
                    },
                    scope.evidence(),
                )?;
                Ok(scope.seal(
                    TestOutcome {
                        operation_id: operation_id.to_owned(),
                        commit_seq: scope.commit_seq(),
                    },
                    ReceiptMetadata {
                        operation_kind: "test",
                        event_sequence: Some(event_sequence),
                        committed_at: "2026-08-07T00:00:00Z",
                    },
                ))
            },
        )
    }

    #[test]
    fn same_operation_and_intent_replays_the_original_manifest_without_reapplying() {
        let directory = tempdir().expect("temporary Profile");
        let kernel = SqliteStoreKernel::open(directory.path()).expect("Core store");
        let executions = AtomicUsize::new(0);
        kernel
            .writer()
            .call(move |connection| {
                let store_epoch = seed(connection)?;
                let context = context();
                let intent_hash = crate::document::sha256(b"same intent");
                let first = with_immediate_transaction(connection, |transaction| {
                    apply_test_mutation(
                        transaction,
                        &context,
                        &store_epoch,
                        "operation:durable-replay",
                        &intent_hash,
                        &executions,
                    )
                })?;
                let replay = with_immediate_transaction(connection, |transaction| {
                    apply_test_mutation(
                        transaction,
                        &context,
                        &store_epoch,
                        "operation:durable-replay",
                        &intent_hash,
                        &executions,
                    )
                })?;
                let CommitResult::Committed {
                    outcome: first_outcome,
                    manifest: first_manifest,
                } = first
                else {
                    panic!("first mutation must commit");
                };
                let CommitResult::IdempotentReplay {
                    outcome: replay_outcome,
                    manifest: Some(replay_manifest),
                } = replay
                else {
                    panic!("second mutation must replay");
                };
                assert_eq!(first_outcome, replay_outcome);
                assert_eq!(first_manifest, replay_manifest);
                assert_eq!(executions.load(Ordering::SeqCst), 1);
                Ok(())
            })
            .expect("durable replay");
    }

    #[test]
    fn intent_collision_fails_closed_and_failed_closure_rolls_back_all_evidence() {
        let directory = tempdir().expect("temporary Profile");
        let kernel = SqliteStoreKernel::open(directory.path()).expect("Core store");
        kernel
            .writer()
            .call(|connection| {
                let store_epoch = seed(connection)?;
                let context = context();
                let first_hash = crate::document::sha256(b"first intent");
                let second_hash = crate::document::sha256(b"second intent");
                let executions = AtomicUsize::new(0);
                with_immediate_transaction(connection, |transaction| {
                    apply_test_mutation(
                        transaction,
                        &context,
                        &store_epoch,
                        "operation:durable-collision",
                        &first_hash,
                        &executions,
                    )
                    .map(|_| ())
                })?;
                let collision = with_immediate_transaction(connection, |transaction| {
                    apply_test_mutation(
                        transaction,
                        &context,
                        &store_epoch,
                        "operation:durable-collision",
                        &second_hash,
                        &executions,
                    )
                    .map(|_| ())
                })
                .expect_err("intent collision must fail");
                assert_eq!(collision.code, StoreErrorCode::IdempotencyKeyReused);

                connection.execute_batch(
                    "CREATE TABLE durable_mutation_fault_marker(id TEXT PRIMARY KEY);",
                )?;
                let failed = with_immediate_transaction(connection, |transaction| {
                    run::<TestOutcome>(
                        transaction,
                        OperationIdentity {
                            module: ModuleName::Database,
                            module_name: "database",
                            operation_id: "operation:durable-fault",
                            intent_hash: &crate::document::sha256(b"fault"),
                            store_epoch: &store_epoch,
                            committed_at: "2026-08-07T00:00:00Z",
                            context: &context,
                        },
                        |scope| {
                            scope.connection().execute(
                                "INSERT INTO durable_mutation_fault_marker(id) VALUES ('fault')",
                                [],
                            )?;
                            Err(StoreError::new(
                                StoreErrorCode::Internal,
                                "injected durable mutation fault",
                                true,
                            ))
                        },
                    )
                    .map(|_| ())
                })
                .expect_err("fault must rollback");
                assert_eq!(failed.code, StoreErrorCode::Internal);
                let marker_count: i64 = connection.query_row(
                    "SELECT count(*) FROM durable_mutation_fault_marker",
                    [],
                    |row| row.get(0),
                )?;
                let orphan_count: i64 = connection.query_row(
                    "SELECT count(*) FROM local_commits
                     WHERE operation_id = 'operation:durable-fault'",
                    [],
                    |row| row.get(0),
                )?;
                assert_eq!((marker_count, orphan_count), (0, 0));
                Ok(())
            })
            .expect("durable fault closure");
    }
}
