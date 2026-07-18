use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::ToSchema;

use crate::{ModuleMutationReceipt, ModuleName, VersionedModuleContract};

pub const DATABASE_CONTRACT_VERSION: u32 = 2;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DatabaseTarget {
    ProjectDefault,
    Database { database_id: String },
    DataSource { data_source_id: String },
    View { view_id: String },
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DatabaseReadMode {
    Catalog,
    Database,
    DataSource,
    View,
    Query,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, ToSchema)]
pub struct DatabaseRead {
    pub target: DatabaseTarget,
    pub mode: DatabaseReadMode,
    pub filter: Option<Value>,
    pub sort: Option<Vec<Value>>,
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DatabaseReadValue {
    Catalog { databases: Vec<Value> },
    Database { value: Value },
    DataSource { value: Value },
    View { value: Value },
    Query { value: Value },
    DataSourceQuery { value: Value },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DatabaseIntent {
    PutProperty {
        data_source_id: String,
        property_id: String,
        expected_data_source_revision: i64,
        expected_property_revision: i64,
        name: String,
        value_type: String,
        before_property_id: Option<String>,
    },
    DeleteProperty {
        data_source_id: String,
        property_id: String,
        expected_data_source_revision: i64,
        expected_property_revision: i64,
    },
    PutOption {
        data_source_id: String,
        property_id: String,
        option_id: String,
        name: String,
        color: Option<String>,
        expected_property_revision: i64,
    },
    DeleteOption {
        data_source_id: String,
        property_id: String,
        option_id: String,
        expected_property_revision: i64,
    },
    SetValue {
        page_id: String,
        data_source_id: String,
        property_id: String,
        expected_value_revision: i64,
        value: Value,
    },
    SetValues {
        values: Vec<DatabasePageValue>,
    },
    AddRemoveValue {
        page_id: String,
        data_source_id: String,
        property_id: String,
        add: Vec<String>,
        remove: Vec<String>,
    },
    TransferPage {
        page_id: String,
        expected_parent_revision: i64,
        expected_active_membership_revision: i64,
        target: DatabaseTransferTarget,
    },
    PutView {
        database_id: String,
        data_source_id: String,
        view_id: String,
        expected_revision: i64,
        name: String,
        view_kind: String,
        config: Value,
        is_default: bool,
        before_view_id: Option<String>,
    },
    DeleteView {
        database_id: String,
        view_id: String,
        expected_revision: i64,
    },
    PositionPage {
        view_id: String,
        page_id: String,
        expected_position_revision: i64,
        group_key: Option<String>,
        before_page_id: Option<String>,
    },
    PositionPages {
        view_id: String,
        pages: Vec<DatabasePagePosition>,
        group_key: Option<String>,
        before_page_id: Option<String>,
    },
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize, ToSchema)]
pub struct DatabasePageValue {
    pub page_id: String,
    pub data_source_id: String,
    pub property_id: String,
    pub expected_value_revision: i64,
    pub value: Value,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct DatabasePagePosition {
    pub page_id: String,
    pub expected_position_revision: i64,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum DatabaseTransferTarget {
    Library { library_id: String },
    Page { page_id: String },
    DataSource { data_source_id: String },
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct DatabaseReceipt {
    #[serde(flatten)]
    pub mutation: ModuleMutationReceipt,
    pub affected_database_ids: Vec<String>,
    pub affected_data_source_ids: Vec<String>,
    pub affected_page_ids: Vec<String>,
    pub affected_view_ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct DatabaseCommitValue {
    pub operation_count: u32,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
pub struct DatabaseEvent {
    pub kind: DatabaseEventKind,
    pub database_ids: Vec<String>,
    pub data_source_ids: Vec<String>,
    pub page_ids: Vec<String>,
    pub view_ids: Vec<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize, ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum DatabaseEventKind {
    DatabaseChanged,
}

pub struct DatabaseContract;

impl VersionedModuleContract for DatabaseContract {
    type Read = DatabaseRead;
    type Snapshot = DatabaseReadValue;
    type Intent = Vec<DatabaseIntent>;
    type Receipt = DatabaseReceipt;
    type Event = DatabaseEvent;

    const VERSION: u32 = DATABASE_CONTRACT_VERSION;
    const MODULE: ModuleName = ModuleName::Database;
}
