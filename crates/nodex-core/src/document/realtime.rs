use std::collections::{BTreeMap, BTreeSet};
use std::sync::{Arc, Mutex};

use nodex_core_contracts::document::{
    OwnedDocumentEvent, OwnedDocumentIntent, OwnedDocumentRead, OwnedDocumentReadValue,
};
use nodex_core_contracts::{
    BoundModuleContext, CORE_CONTRACT_VERSION, CommittedCoreModuleEvent, CoreError, CoreErrorCode,
    CoreErrorRecovery, CoreModuleEventPayload, ModuleApplyRequest, ModuleReadRequest,
    ModuleReadSnapshot, StoreEpoch,
};

use super::event_log::DocumentEventReplay;
use crate::infrastructure::document_repository::DocumentSyncEngine;

use super::{DocumentAwareness, OwnedDocumentApplyOutcome, OwnedDocumentModule};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DocumentSubscriptionEngine {
    Yjs,
    CanvasScene,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DocumentSubscriptionAck {
    pub document_id: String,
    pub store_epoch: StoreEpoch,
    pub generation: i64,
    pub head_seq: i64,
    pub event_head: i64,
    pub engine: DocumentSubscriptionEngine,
    pub awareness_update: Option<Vec<u8>>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum DocumentRealtimeEvent {
    Committed(CommittedCoreModuleEvent),
    Awareness {
        document_id: String,
        store_epoch: StoreEpoch,
        generation: i64,
        client_session_id: String,
        update: Vec<u8>,
    },
    ResyncRequired {
        document_id: String,
        store_epoch: StoreEpoch,
        generation: i64,
        head_seq: i64,
        event_head: i64,
    },
}

#[derive(Debug, Clone, PartialEq)]
pub struct DocumentRealtimeReplay {
    pub events: Vec<DocumentRealtimeEvent>,
    pub next_after: i64,
    pub event_head: i64,
}

#[derive(Debug, Clone, PartialEq)]
pub struct AwarenessPublication {
    pub event: DocumentRealtimeEvent,
    pub recipient_connections: Vec<String>,
}

struct Subscription {
    context: BoundModuleContext,
    document_id: String,
    client_session_id: String,
    store_epoch: StoreEpoch,
    generation: i64,
    head_seq: i64,
    engine: DocumentSubscriptionEngine,
    awareness_client_ids: BTreeSet<u64>,
}

#[derive(Default)]
struct RealtimeState {
    subscriptions: BTreeMap<(String, String), Subscription>,
    awareness_owners: BTreeMap<(String, u64), (String, String)>,
    awareness_documents: BTreeMap<String, DocumentAwareness>,
}

#[derive(Clone)]
pub struct OwnedDocumentRealtimeAdapter {
    module: OwnedDocumentModule,
    state: Arc<Mutex<RealtimeState>>,
}

impl OwnedDocumentRealtimeAdapter {
    pub fn new(module: OwnedDocumentModule) -> Self {
        Self {
            module,
            state: Arc::new(Mutex::new(RealtimeState::default())),
        }
    }

    pub fn subscribe(
        &self,
        context: &BoundModuleContext,
        document_id: String,
        client_session_id: String,
    ) -> Result<DocumentSubscriptionAck, CoreError> {
        validate_identity(&document_id, "Document")?;
        validate_identity(&client_session_id, "client session")?;
        let boundary = self
            .module
            .authorize_realtime_subscription(context, &document_id)?;
        let engine = match boundary.engine {
            DocumentSyncEngine::Yjs => DocumentSubscriptionEngine::Yjs,
            DocumentSyncEngine::CanvasScene => DocumentSubscriptionEngine::CanvasScene,
        };
        let key = (context.connection_id.clone(), client_session_id.clone());
        let mut state = self.lock_state()?;
        if let Some(existing) = state.subscriptions.get(&key)
            && (existing.document_id != document_id
                || existing.context.project_id != context.project_id
                || existing.context.profile_id != context.profile_id)
        {
            return Err(unauthorized(
                "A client session cannot be rebound to a different Document boundary",
            ));
        }
        state
            .subscriptions
            .entry(key)
            .or_insert_with(|| Subscription {
                context: context.clone(),
                document_id: document_id.clone(),
                client_session_id,
                store_epoch: boundary.store_epoch.clone(),
                generation: boundary.generation,
                head_seq: boundary.head_seq,
                engine,
                awareness_client_ids: BTreeSet::new(),
            });
        let awareness_update = if engine == DocumentSubscriptionEngine::Yjs {
            Some(
                state
                    .awareness_documents
                    .entry(document_id.clone())
                    .or_insert_with(|| DocumentAwareness::new(&document_id))
                    .full_update_v1()
                    .map_err(engine_error)?,
            )
        } else {
            None
        };
        Ok(DocumentSubscriptionAck {
            document_id,
            store_epoch: boundary.store_epoch,
            generation: boundary.generation,
            head_seq: boundary.head_seq,
            event_head: boundary.event_head,
            engine,
            awareness_update,
        })
    }

    pub fn require_subscription(
        &self,
        connection_id: &str,
        client_session_id: &str,
        document_id: &str,
    ) -> Result<DocumentSubscriptionAck, CoreError> {
        let state = self.lock_state()?;
        let subscription = state
            .subscriptions
            .get(&(connection_id.to_owned(), client_session_id.to_owned()))
            .filter(|subscription| subscription.document_id == document_id)
            .ok_or_else(|| unauthorized("An exact Document subscription is required"))?;
        Ok(subscription_ack(subscription, 0))
    }

    pub fn sync_yjs(
        &self,
        context: &BoundModuleContext,
        client_session_id: &str,
        document_id: String,
        state_vector: Vec<u8>,
    ) -> Result<ModuleReadSnapshot<OwnedDocumentReadValue>, CoreError> {
        let subscription =
            self.require_subscription(&context.connection_id, client_session_id, &document_id)?;
        if subscription.engine != DocumentSubscriptionEngine::Yjs {
            return Err(invalid("Yjs sync requires a Yjs subscription"));
        }
        self.module.read(
            context,
            ModuleReadRequest {
                version: CORE_CONTRACT_VERSION,
                read: OwnedDocumentRead::SyncYjs {
                    document_id,
                    state_vector,
                },
            },
        )
    }

    pub fn sync_canvas(
        &self,
        context: &BoundModuleContext,
        client_session_id: &str,
        document_id: String,
    ) -> Result<ModuleReadSnapshot<OwnedDocumentReadValue>, CoreError> {
        let subscription =
            self.require_subscription(&context.connection_id, client_session_id, &document_id)?;
        if subscription.engine != DocumentSubscriptionEngine::CanvasScene {
            return Err(invalid("Canvas sync requires a Canvas subscription"));
        }
        self.module.read(
            context,
            ModuleReadRequest {
                version: CORE_CONTRACT_VERSION,
                read: OwnedDocumentRead::SyncCanvas { document_id },
            },
        )
    }

    pub fn apply(
        &self,
        context: &BoundModuleContext,
        client_session_id: &str,
        request: ModuleApplyRequest<OwnedDocumentIntent>,
    ) -> Result<OwnedDocumentApplyOutcome, CoreError> {
        let document_id = intent_document_id(&request.intent)
            .ok_or_else(|| invalid("Realtime Adapter accepts only Document-bound mutations"))?;
        self.require_subscription(&context.connection_id, client_session_id, document_id)?;
        let outcome = self.module.apply(context, request)?;
        if let Some(event) = outcome.event.as_ref() {
            self.adopt_committed_boundary(event)?;
        }
        Ok(outcome)
    }

    pub fn replay(
        &self,
        connection_id: &str,
        client_session_id: &str,
        after: i64,
        limit: Option<u32>,
    ) -> Result<DocumentRealtimeReplay, CoreError> {
        let (context, document_id, boundary) = {
            let state = self.lock_state()?;
            let subscription = state
                .subscriptions
                .get(&(connection_id.to_owned(), client_session_id.to_owned()))
                .ok_or_else(|| unauthorized("An exact Document subscription is required"))?;
            (
                subscription.context.clone(),
                subscription.document_id.clone(),
                subscription_ack(subscription, 0),
            )
        };
        let replay = self.module.replay_document_events(&context, after, limit)?;
        match replay {
            DocumentEventReplay::Events {
                events,
                next_after,
                event_head,
            } => Ok(DocumentRealtimeReplay {
                events: events
                    .into_iter()
                    .filter(|event| event_document_id(event) == Some(document_id.as_str()))
                    .map(DocumentRealtimeEvent::Committed)
                    .collect(),
                next_after,
                event_head,
            }),
            DocumentEventReplay::ResyncRequired { event_head, .. } => Ok(DocumentRealtimeReplay {
                events: vec![DocumentRealtimeEvent::ResyncRequired {
                    document_id,
                    store_epoch: boundary.store_epoch,
                    generation: boundary.generation,
                    head_seq: boundary.head_seq,
                    event_head,
                }],
                next_after: event_head,
                event_head,
            }),
        }
    }

    pub fn publish_awareness(
        &self,
        connection_id: &str,
        client_session_id: &str,
        store_epoch: &StoreEpoch,
        generation: i64,
        update: &[u8],
    ) -> Result<Option<AwarenessPublication>, CoreError> {
        let key = (connection_id.to_owned(), client_session_id.to_owned());
        let mut state = self.lock_state()?;
        let inspected = DocumentAwareness::inspect_update_v1(update).map_err(engine_error)?;
        let document_id = state
            .subscriptions
            .get(&key)
            .ok_or_else(|| unauthorized("An exact Yjs subscription is required"))?
            .document_id
            .clone();
        for (client_id, _) in &inspected {
            if let Some(owner) = state
                .awareness_owners
                .get(&(document_id.clone(), *client_id))
                && owner != &key
            {
                return Err(unauthorized(
                    "Awareness client identity is already owned by another subscription",
                ));
            }
        }
        let (subscription_store_epoch, subscription_generation) = {
            let subscription = state
                .subscriptions
                .get(&key)
                .ok_or_else(|| unauthorized("An exact Yjs subscription is required"))?;
            if subscription.engine != DocumentSubscriptionEngine::Yjs {
                return Err(invalid("Canvas subscriptions do not accept Awareness"));
            }
            if &subscription.store_epoch != store_epoch || subscription.generation != generation {
                return Err(CoreError {
                    code: CoreErrorCode::GenerationConflict,
                    message: "Awareness belongs to a different Document identity boundary"
                        .to_owned(),
                    retryable: false,
                    recovery: CoreErrorRecovery::CurrentDocumentHead {
                        generation: subscription.generation,
                        head_seq: subscription.head_seq,
                    },
                });
            }
            (subscription.store_epoch.clone(), subscription.generation)
        };
        let change = state
            .awareness_documents
            .get_mut(&document_id)
            .ok_or_else(|| internal("Yjs Document Awareness is missing"))?
            .apply_update_v1(update)
            .map_err(engine_error)?;
        let Some(change) = change else {
            return Ok(None);
        };
        let changed_ids = change
            .added
            .iter()
            .chain(change.updated.iter())
            .chain(change.removed.iter())
            .copied()
            .collect::<BTreeSet<_>>();
        if let Some(subscription) = state.subscriptions.get_mut(&key) {
            for client_id in change.added.iter().chain(change.updated.iter()) {
                subscription.awareness_client_ids.insert(*client_id);
            }
            for client_id in &change.removed {
                subscription.awareness_client_ids.remove(client_id);
            }
        }
        for client_id in change.added.iter().chain(change.updated.iter()) {
            state
                .awareness_owners
                .insert((document_id.clone(), *client_id), key.clone());
        }
        for client_id in &change.removed {
            state
                .awareness_owners
                .remove(&(document_id.clone(), *client_id));
        }
        if changed_ids.is_empty() {
            return Ok(None);
        }
        let recipients = recipients_for_document(&state, &document_id, &key);
        Ok(Some(AwarenessPublication {
            event: DocumentRealtimeEvent::Awareness {
                document_id,
                store_epoch: subscription_store_epoch,
                generation: subscription_generation,
                client_session_id: client_session_id.to_owned(),
                update: update.to_vec(),
            },
            recipient_connections: recipients,
        }))
    }

    pub fn disconnect(&self, connection_id: &str) -> Result<Vec<AwarenessPublication>, CoreError> {
        let mut state = self.lock_state()?;
        let keys = state
            .subscriptions
            .keys()
            .filter(|(candidate, _)| candidate == connection_id)
            .cloned()
            .collect::<Vec<_>>();
        let mut publications = Vec::new();
        for key in keys {
            let Some(subscription) = state.subscriptions.remove(&key) else {
                continue;
            };
            for client_id in &subscription.awareness_client_ids {
                state
                    .awareness_owners
                    .remove(&(subscription.document_id.clone(), *client_id));
            }
            if subscription.awareness_client_ids.is_empty() {
                continue;
            }
            let update = state
                .awareness_documents
                .get_mut(&subscription.document_id)
                .ok_or_else(|| internal("Yjs Document Awareness is missing"))?
                .remove_clients_v1(
                    &subscription
                        .awareness_client_ids
                        .iter()
                        .copied()
                        .collect::<Vec<_>>(),
                )
                .map_err(engine_error)?;
            publications.push(AwarenessPublication {
                event: DocumentRealtimeEvent::Awareness {
                    document_id: subscription.document_id.clone(),
                    store_epoch: subscription.store_epoch,
                    generation: subscription.generation,
                    client_session_id: subscription.client_session_id,
                    update,
                },
                recipient_connections: recipients_for_document(
                    &state,
                    &subscription.document_id,
                    &key,
                ),
            });
            if !state
                .subscriptions
                .values()
                .any(|candidate| candidate.document_id == subscription.document_id)
            {
                state.awareness_documents.remove(&subscription.document_id);
            }
        }
        Ok(publications)
    }

    pub fn revoke_document_access(&self, document_id: &str) -> Result<Vec<String>, CoreError> {
        let mut state = self.lock_state()?;
        let connections = state
            .subscriptions
            .iter()
            .filter(|(_, subscription)| subscription.document_id == document_id)
            .map(|((connection_id, _), _)| connection_id.clone())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect::<Vec<_>>();
        let keys = state
            .subscriptions
            .iter()
            .filter(|(_, subscription)| subscription.document_id == document_id)
            .map(|(key, _)| key.clone())
            .collect::<Vec<_>>();
        for key in keys {
            if let Some(subscription) = state.subscriptions.remove(&key) {
                for client_id in subscription.awareness_client_ids {
                    state
                        .awareness_owners
                        .remove(&(subscription.document_id.clone(), client_id));
                }
            }
        }
        state.awareness_documents.remove(document_id);
        Ok(connections)
    }

    fn adopt_committed_boundary(&self, event: &CommittedCoreModuleEvent) -> Result<(), CoreError> {
        let Some(document_id) = event_document_id(event) else {
            return Ok(());
        };
        let mut state = self.lock_state()?;
        for subscription in state.subscriptions.values_mut() {
            if subscription.document_id != document_id {
                continue;
            }
            subscription.store_epoch = event.store_epoch.clone();
            match &event.payload {
                CoreModuleEventPayload::OwnedDocument(OwnedDocumentEvent::DocumentUpdated {
                    generation,
                    head_seq,
                    ..
                })
                | CoreModuleEventPayload::OwnedDocument(OwnedDocumentEvent::CanvasUpdated {
                    generation,
                    head_seq,
                    ..
                }) => {
                    subscription.generation = *generation;
                    subscription.head_seq = *head_seq;
                }
                _ => {}
            }
        }
        Ok(())
    }

    fn lock_state(&self) -> Result<std::sync::MutexGuard<'_, RealtimeState>, CoreError> {
        self.state
            .lock()
            .map_err(|_| internal("Document realtime state lock failed"))
    }
}

fn subscription_ack(subscription: &Subscription, event_head: i64) -> DocumentSubscriptionAck {
    DocumentSubscriptionAck {
        document_id: subscription.document_id.clone(),
        store_epoch: subscription.store_epoch.clone(),
        generation: subscription.generation,
        head_seq: subscription.head_seq,
        event_head,
        engine: subscription.engine,
        awareness_update: None,
    }
}

fn recipients_for_document(
    state: &RealtimeState,
    document_id: &str,
    sender: &(String, String),
) -> Vec<String> {
    state
        .subscriptions
        .iter()
        .filter(|(key, subscription)| *key != sender && subscription.document_id == document_id)
        .map(|((connection_id, _), _)| connection_id.clone())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect()
}

fn intent_document_id(intent: &OwnedDocumentIntent) -> Option<&str> {
    match intent {
        OwnedDocumentIntent::ApplyYjsUpdate { document_id, .. }
        | OwnedDocumentIntent::ApplySemanticMutation { document_id, .. }
        | OwnedDocumentIntent::ApplyCanvasMutation { document_id, .. }
        | OwnedDocumentIntent::CreateCheckpoint { document_id, .. }
        | OwnedDocumentIntent::RestoreVersion { document_id, .. } => Some(document_id),
        OwnedDocumentIntent::PrepareOwner { .. }
        | OwnedDocumentIntent::ApplyOwnerCommand { .. } => None,
    }
}

fn event_document_id(event: &CommittedCoreModuleEvent) -> Option<&str> {
    match &event.payload {
        CoreModuleEventPayload::OwnedDocument(OwnedDocumentEvent::DocumentUpdated {
            document_id,
            ..
        })
        | CoreModuleEventPayload::OwnedDocument(OwnedDocumentEvent::CanvasUpdated {
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

fn validate_identity(value: &str, label: &str) -> Result<(), CoreError> {
    if !value.is_empty() && value.len() <= 512 && value.trim() == value {
        return Ok(());
    }
    Err(invalid(format!("{label} identity is invalid")))
}

fn engine_error(error: super::YrsEngineError) -> CoreError {
    CoreError {
        code: CoreErrorCode::InvalidInput,
        message: error.to_string(),
        retryable: false,
        recovery: CoreErrorRecovery::None,
    }
}

fn invalid(message: impl Into<String>) -> CoreError {
    CoreError {
        code: CoreErrorCode::InvalidInput,
        message: message.into(),
        retryable: false,
        recovery: CoreErrorRecovery::None,
    }
}

fn unauthorized(message: &str) -> CoreError {
    CoreError {
        code: CoreErrorCode::Unauthorized,
        message: message.to_owned(),
        retryable: false,
        recovery: CoreErrorRecovery::None,
    }
}

fn internal(message: &str) -> CoreError {
    CoreError {
        code: CoreErrorCode::CoreUnavailable,
        message: message.to_owned(),
        retryable: true,
        recovery: CoreErrorRecovery::None,
    }
}
