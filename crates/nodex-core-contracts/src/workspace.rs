use serde::{Deserialize, Serialize};

use crate::{ModuleName, VersionedModuleContract};

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ProjectWorkspaceRead {
    Project { project_id: String },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ProjectWorkspaceSnapshot {
    pub project_id: String,
    pub archived: bool,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ProjectWorkspaceIntent {
    ArchiveProject { project_id: String },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ProjectWorkspaceReceipt {
    pub project_id: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
pub struct ProjectWorkspaceEvent {
    pub project_id: String,
}

pub struct ProjectWorkspaceContract;

impl VersionedModuleContract for ProjectWorkspaceContract {
    type Read = ProjectWorkspaceRead;
    type Snapshot = ProjectWorkspaceSnapshot;
    type Intent = ProjectWorkspaceIntent;
    type Receipt = ProjectWorkspaceReceipt;
    type Event = ProjectWorkspaceEvent;

    const VERSION: u32 = 1;
    const MODULE: ModuleName = ModuleName::Workspace;
}
