use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use nodex_core::document::{AwarenessPublication, DocumentRealtimeEvent};
use nodex_core::infrastructure::event_log::CoreEventLog;
#[cfg(test)]
use nodex_core_contracts::StoreEpoch;
use tokio::sync::broadcast;
use tokio::sync::mpsc;

const DOCUMENT_LIVE_PUBLICATION_QUEUE_CAPACITY: usize = 1_024;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum DocumentLiveRepairKind {
    IdentityChanged,
    PayloadUnavailable,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum DocumentLiveNotice {
    Commit(i64),
    Repair {
        store_epoch: String,
        commit_head: i64,
        reason: DocumentLiveRepairKind,
    },
}

struct DocumentChannel {
    sender: broadcast::Sender<DocumentLiveNotice>,
    realtime_sender: broadcast::Sender<AwarenessPublication>,
}

struct DocumentLiveHubState {
    store_epoch: String,
    channels: BTreeMap<String, Arc<DocumentChannel>>,
}

/// Route-aware publication boundary for exact Document live sessions.
///
/// The durable LocalCommit stream remains process-wide. This Hub only wakes
/// sessions addressed by a commit's immutable Document routing claims, while
/// Store identity changes and routing failures are broadcast as explicit
/// repair barriers to every open session.
#[derive(Clone)]
pub(crate) struct DocumentLiveHub {
    capacity: usize,
    state: Arc<Mutex<DocumentLiveHubState>>,
}

impl DocumentLiveHub {
    pub(crate) fn new(store_epoch: String, capacity: usize) -> Self {
        assert!(
            !store_epoch.is_empty(),
            "Document live Store epoch is required"
        );
        assert!(
            capacity > 0,
            "Document live channel capacity must be positive"
        );
        Self {
            capacity,
            state: Arc::new(Mutex::new(DocumentLiveHubState {
                store_epoch,
                channels: BTreeMap::new(),
            })),
        }
    }

    pub(crate) fn subscribe(&self, document_id: String) -> DocumentLiveSubscription {
        let channel = {
            let mut state = self.state.lock().expect("Document live Hub mutex poisoned");
            Arc::clone(
                state
                    .channels
                    .entry(document_id.clone())
                    .or_insert_with(|| {
                        let (sender, _) = broadcast::channel(self.capacity);
                        let (realtime_sender, _) = broadcast::channel(self.capacity);
                        Arc::new(DocumentChannel {
                            sender,
                            realtime_sender,
                        })
                    }),
            )
        };
        let receiver = channel.sender.subscribe();
        let realtime_receiver = channel.realtime_sender.subscribe();
        DocumentLiveSubscription {
            document_id,
            channel,
            hub: self.clone(),
            receiver,
            realtime_receiver,
        }
    }

    fn accepts_publication(&self, store_epoch: &str) -> bool {
        let state = self.state.lock().expect("Document live Hub mutex poisoned");
        state.store_epoch == store_epoch && !state.channels.is_empty()
    }

    pub(crate) fn publish_commit(
        &self,
        commit_seq: i64,
        store_epoch: &str,
        document_ids: &[String],
    ) {
        let state = self.state.lock().expect("Document live Hub mutex poisoned");
        if state.store_epoch != store_epoch {
            // Store replacement publishes one explicit identity repair when it
            // advances the Hub epoch. Publications already queued for the old
            // Store are obsolete; repeating repair for each one would force
            // fresh sessions into a reconnect storm.
            return;
        }
        for document_id in document_ids {
            let Some(channel) = state.channels.get(document_id) else {
                continue;
            };
            let _ = channel.sender.send(DocumentLiveNotice::Commit(commit_seq));
        }
    }

    pub(crate) fn publish_repair(
        &self,
        store_epoch: &str,
        commit_head: i64,
        reason: DocumentLiveRepairKind,
    ) {
        let mut state = self.state.lock().expect("Document live Hub mutex poisoned");
        if reason == DocumentLiveRepairKind::IdentityChanged {
            state.store_epoch = store_epoch.to_owned();
        } else if state.store_epoch != store_epoch {
            return;
        }
        let repair_store_epoch = state.store_epoch.clone();
        publish_to_all(
            &state.channels,
            DocumentLiveNotice::Repair {
                store_epoch: repair_store_epoch,
                commit_head,
                reason,
            },
        );
    }

    pub(crate) fn publish_awareness(&self, publication: AwarenessPublication) {
        let (document_id, store_epoch) = match &publication.event {
            DocumentRealtimeEvent::Awareness {
                document_id,
                store_epoch,
                ..
            } => (document_id, &store_epoch.0),
        };
        let state = self.state.lock().expect("Document live Hub mutex poisoned");
        if state.store_epoch != *store_epoch {
            return;
        }
        let Some(channel) = state.channels.get(document_id) else {
            return;
        };
        let _ = channel.realtime_sender.send(publication);
    }
}

struct DocumentLivePublication {
    commit_seq: i64,
    store_epoch: String,
}

/// Ordered asynchronous Adapter from committed identities to exact-resource
/// live notices. Enqueueing is O(1), so durable fanout is never a prerequisite
/// for returning the initiating command's apply response.
#[derive(Clone)]
pub(crate) struct DocumentLivePublisher {
    sender: mpsc::Sender<DocumentLivePublication>,
    hub: DocumentLiveHub,
}

impl DocumentLivePublisher {
    pub(crate) fn start(event_log: CoreEventLog, hub: DocumentLiveHub) -> Self {
        let (sender, mut receiver) =
            mpsc::channel::<DocumentLivePublication>(DOCUMENT_LIVE_PUBLICATION_QUEUE_CAPACITY);
        let worker_hub = hub.clone();
        tokio::spawn(async move {
            while let Some(publication) = receiver.recv().await {
                if !worker_hub.accepts_publication(&publication.store_epoch) {
                    continue;
                }
                let worker_event_log = event_log.clone();
                let commit_seq = publication.commit_seq;
                let store_epoch = publication.store_epoch.clone();
                let routes = tokio::task::spawn_blocking(move || {
                    worker_event_log.document_live_routes(&store_epoch, commit_seq)
                })
                .await;
                if !worker_hub.accepts_publication(&publication.store_epoch) {
                    continue;
                }
                match routes {
                    Ok(Ok(document_ids)) => worker_hub.publish_commit(
                        publication.commit_seq,
                        &publication.store_epoch,
                        &document_ids,
                    ),
                    Ok(Err(error)) => {
                        tracing::error!(
                            error = %error.message,
                            commitSequence = publication.commit_seq,
                            "Document live routing claims are unavailable"
                        );
                        worker_hub.publish_repair(
                            &publication.store_epoch,
                            publication.commit_seq,
                            DocumentLiveRepairKind::PayloadUnavailable,
                        );
                    }
                    Err(error) => {
                        tracing::error!(
                            error = %error,
                            commitSequence = publication.commit_seq,
                            "Document live routing worker failed"
                        );
                        worker_hub.publish_repair(
                            &publication.store_epoch,
                            publication.commit_seq,
                            DocumentLiveRepairKind::PayloadUnavailable,
                        );
                    }
                }
            }
        });
        Self { sender, hub }
    }

    pub(crate) fn publish(&self, commit_seq: i64, store_epoch: String) {
        // A later subscriber's canonical barrier includes every commit already
        // present here, so resolving routes without any live channel is pure
        // background work with no consumer.
        if !self.hub.accepts_publication(&store_epoch) {
            return;
        }
        let publication = DocumentLivePublication {
            commit_seq,
            store_epoch: store_epoch.clone(),
        };
        if self.sender.try_send(publication).is_ok() {
            return;
        }
        tracing::error!(
            commitSequence = commit_seq,
            "Document live publication queue is unavailable"
        );
        self.hub.publish_repair(
            &store_epoch,
            commit_seq,
            DocumentLiveRepairKind::PayloadUnavailable,
        );
    }
}

fn publish_to_all(channels: &BTreeMap<String, Arc<DocumentChannel>>, notice: DocumentLiveNotice) {
    for channel in channels.values() {
        let _ = channel.sender.send(notice.clone());
    }
}

pub(crate) struct DocumentLiveSubscription {
    document_id: String,
    channel: Arc<DocumentChannel>,
    hub: DocumentLiveHub,
    receiver: broadcast::Receiver<DocumentLiveNotice>,
    realtime_receiver: broadcast::Receiver<AwarenessPublication>,
}

impl DocumentLiveSubscription {
    pub(crate) fn receivers(
        &mut self,
    ) -> (
        &mut broadcast::Receiver<DocumentLiveNotice>,
        &mut broadcast::Receiver<AwarenessPublication>,
    ) {
        (&mut self.receiver, &mut self.realtime_receiver)
    }

    #[cfg(test)]
    fn try_recv(&mut self) -> Result<DocumentLiveNotice, broadcast::error::TryRecvError> {
        self.receiver.try_recv()
    }
}

impl Drop for DocumentLiveSubscription {
    fn drop(&mut self) {
        let mut state = self
            .hub
            .state
            .lock()
            .expect("Document live Hub mutex poisoned");
        let Some(current) = state.channels.get(&self.document_id) else {
            return;
        };
        if Arc::ptr_eq(current, &self.channel) && Arc::strong_count(current) == 2 {
            state.channels.remove(&self.document_id);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wakes_only_addressed_documents_and_broadcasts_identity_repairs() {
        let hub = DocumentLiveHub::new("epoch:one".to_owned(), 4);
        let mut first = hub.subscribe("document:first".to_owned());
        let mut second = hub.subscribe("document:second".to_owned());

        hub.publish_commit(3, "epoch:one", &["document:first".to_owned()]);
        assert_eq!(first.try_recv(), Ok(DocumentLiveNotice::Commit(3)));
        assert_eq!(
            second.try_recv(),
            Err(broadcast::error::TryRecvError::Empty),
        );

        hub.publish_repair("epoch:two", 1, DocumentLiveRepairKind::IdentityChanged);
        let expected = DocumentLiveNotice::Repair {
            store_epoch: "epoch:two".to_owned(),
            commit_head: 1,
            reason: DocumentLiveRepairKind::IdentityChanged,
        };
        assert_eq!(first.try_recv(), Ok(expected.clone()));
        assert_eq!(second.try_recv(), Ok(expected));

        hub.publish_commit(2, "epoch:one", &["document:first".to_owned()]);
        assert_eq!(first.try_recv(), Err(broadcast::error::TryRecvError::Empty));
        assert_eq!(
            second.try_recv(),
            Err(broadcast::error::TryRecvError::Empty)
        );

        hub.publish_repair("epoch:one", 3, DocumentLiveRepairKind::PayloadUnavailable);
        assert_eq!(first.try_recv(), Err(broadcast::error::TryRecvError::Empty));
        assert_eq!(
            second.try_recv(),
            Err(broadcast::error::TryRecvError::Empty)
        );

        let awareness = AwarenessPublication {
            event: DocumentRealtimeEvent::Awareness {
                document_id: "document:first".to_owned(),
                store_epoch: StoreEpoch("epoch:two".to_owned()),
                generation: 1,
                client_session_id: "session:first".to_owned(),
                update: vec![1, 2, 3],
            },
            recipient_connections: vec!["connection:first".to_owned()],
        };
        hub.publish_awareness(awareness.clone());
        assert_eq!(first.realtime_receiver.try_recv(), Ok(awareness));
        assert_eq!(
            second.realtime_receiver.try_recv(),
            Err(broadcast::error::TryRecvError::Empty)
        );
    }
}
