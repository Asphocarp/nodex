//! The canonical in-memory shape of the terminal BlockRecord model.
//!
//! This module deliberately does not know about Yrs, SQLite, or BlockNote.
//! Those are adapters at later seams.  The owning placement forest is the
//! structural authority: a Block has one placement, and descendants remain
//! attached to their stable parent IDs when a root moves.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Deserializer, Serialize, Serializer};
use serde_json::Value;
use thiserror::Error;

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum BlockKind {
    Page,
    Paragraph,
    Heading,
    ListItem,
    Toggle,
    Quote,
    Code,
    Media,
    Database,
    Canvas,
    Reference,
    Other(String),
}

impl Serialize for BlockKind {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: Serializer,
    {
        self.as_wire_name().serialize(serializer)
    }
}

impl<'de> Deserialize<'de> for BlockKind {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        Ok(Self::from_wire_name(value))
    }
}

impl BlockKind {
    fn as_wire_name(&self) -> String {
        match self {
            Self::Page => "page".to_owned(),
            Self::Paragraph => "paragraph".to_owned(),
            Self::Heading => "heading".to_owned(),
            Self::ListItem => "list_item".to_owned(),
            Self::Toggle => "toggle".to_owned(),
            Self::Quote => "quote".to_owned(),
            Self::Code => "code".to_owned(),
            Self::Media => "media".to_owned(),
            Self::Database => "database".to_owned(),
            Self::Canvas => "canvas".to_owned(),
            Self::Reference => "reference".to_owned(),
            Self::Other(value) => value.clone(),
        }
    }

    fn from_wire_name(value: String) -> Self {
        match value.as_str() {
            "page" => Self::Page,
            "paragraph" => Self::Paragraph,
            "heading" => Self::Heading,
            "list_item" => Self::ListItem,
            "toggle" => Self::Toggle,
            "quote" => Self::Quote,
            "code" => Self::Code,
            "media" => Self::Media,
            "database" => Self::Database,
            "canvas" => Self::Canvas,
            "reference" => Self::Reference,
            _ => Self::Other(value),
        }
    }

    pub fn can_contain_children(&self) -> bool {
        matches!(
            self,
            Self::Page
                | Self::Paragraph
                | Self::Heading
                | Self::ListItem
                | Self::Toggle
                | Self::Quote
                | Self::Code
                | Self::Database
                | Self::Other(_)
        )
    }

    pub fn can_promote_to_page(&self) -> bool {
        matches!(
            self,
            Self::Paragraph
                | Self::Heading
                | Self::ListItem
                | Self::Toggle
                | Self::Quote
                | Self::Code
                | Self::Media
        )
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BlockLifecycle {
    Active,
    Archived,
    Retired,
}

impl BlockLifecycle {
    pub fn is_active(&self) -> bool {
        matches!(self, Self::Active)
    }
}

#[derive(Clone, Debug, Eq, PartialEq, Ord, PartialOrd, Serialize, Deserialize)]
#[serde(tag = "kind", content = "id", rename_all = "snake_case")]
pub enum PlacementParent {
    Library,
    Block(String),
    DataSource(String),
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct BlockRecord {
    pub id: String,
    pub library_id: String,
    pub kind: BlockKind,
    pub lifecycle: BlockLifecycle,
    pub properties: Value,
    pub content_shard_id: String,
    pub revision: u64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct BlockPlacement {
    pub block_id: String,
    pub parent: PlacementParent,
    pub rank_key: String,
    pub revision: u64,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct PlacementChange {
    pub block_id: String,
    pub parent: PlacementParent,
    pub rank_key: String,
}

/// A View position is a presentation edge, not an owning placement.  A Page
/// can appear in more than one View while still having exactly one owning
/// `BlockPlacement`.
#[derive(Clone, Debug, Eq, PartialEq, Serialize, Deserialize)]
pub struct BlockViewPosition {
    pub view_id: String,
    pub data_source_id: String,
    pub block_id: String,
    pub group_key: Option<String>,
    pub rank_key: String,
    pub revision: u64,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum BlockRecordErrorCode {
    EmptyIdentity,
    LibraryMismatch,
    DuplicateIdentity,
    MissingPlacement,
    PlacementIdentityMismatch,
    MissingParent,
    InvalidParentKind,
    InvalidPlacementRank,
    DuplicateSiblingRank,
    Cycle,
    RetiredBlock,
    NoChange,
    NotPromotable,
    Overflow,
}

#[derive(Clone, Debug, Eq, PartialEq, Error)]
#[error("BlockRecord graph error {code:?}: {message}")]
pub struct BlockRecordError {
    pub code: BlockRecordErrorCode,
    pub message: String,
    pub block_id: Option<String>,
}

#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize, Deserialize)]
pub struct RecordGraph {
    library_id: String,
    blocks: BTreeMap<String, BlockRecord>,
    placements: BTreeMap<String, BlockPlacement>,
}

impl RecordGraph {
    pub fn new(library_id: impl Into<String>) -> Result<Self, BlockRecordError> {
        let library_id = library_id.into();
        require_identity(
            &library_id,
            BlockRecordErrorCode::EmptyIdentity,
            "library_id",
        )?;
        Ok(Self {
            library_id,
            blocks: BTreeMap::new(),
            placements: BTreeMap::new(),
        })
    }

    pub fn library_id(&self) -> &str {
        &self.library_id
    }

    pub fn block(&self, block_id: &str) -> Option<&BlockRecord> {
        self.blocks.get(block_id)
    }

    pub fn placement(&self, block_id: &str) -> Option<&BlockPlacement> {
        self.placements.get(block_id)
    }

    pub fn blocks(&self) -> impl Iterator<Item = &BlockRecord> {
        self.blocks.values()
    }

    pub fn placements(&self) -> impl Iterator<Item = &BlockPlacement> {
        self.placements.values()
    }

    pub fn from_parts(
        library_id: impl Into<String>,
        blocks: impl IntoIterator<Item = BlockRecord>,
        placements: impl IntoIterator<Item = BlockPlacement>,
    ) -> Result<Self, BlockRecordError> {
        let library_id = library_id.into();
        let mut graph = Self::new(library_id)?;
        for block in blocks {
            if graph.blocks.insert(block.id.clone(), block).is_some() {
                return Err(graph_error(
                    BlockRecordErrorCode::DuplicateIdentity,
                    "BlockRecord list contains a duplicate id",
                    None,
                ));
            }
        }
        for placement in placements {
            if graph
                .placements
                .insert(placement.block_id.clone(), placement)
                .is_some()
            {
                return Err(graph_error(
                    BlockRecordErrorCode::DuplicateIdentity,
                    "Placement list contains a duplicate block_id",
                    None,
                ));
            }
        }
        graph.validate()?;
        Ok(graph)
    }

    pub fn insert(
        &mut self,
        record: BlockRecord,
        placement: BlockPlacement,
    ) -> Result<(), BlockRecordError> {
        self.validate_record_identity(&record)?;
        if self.blocks.contains_key(&record.id) {
            return Err(graph_error(
                BlockRecordErrorCode::DuplicateIdentity,
                format!("Block {} already exists", record.id),
                Some(record.id),
            ));
        }
        if placement.block_id != record.id {
            return Err(graph_error(
                BlockRecordErrorCode::PlacementIdentityMismatch,
                "Placement block_id must match the BlockRecord id",
                Some(record.id),
            ));
        }
        validate_rank_key(&placement.rank_key, &record.id)?;

        let previous = self.clone();
        self.blocks.insert(record.id.clone(), record);
        self.placements
            .insert(placement.block_id.clone(), placement);
        if let Err(error) = self.validate() {
            *self = previous;
            return Err(error);
        }
        Ok(())
    }

    pub fn validate(&self) -> Result<(), BlockRecordError> {
        for record in self.blocks.values() {
            self.validate_record_identity(record)?;
            let Some(placement) = self.placements.get(&record.id) else {
                return Err(graph_error(
                    BlockRecordErrorCode::MissingPlacement,
                    format!("Active Block {} has no placement", record.id),
                    Some(record.id.clone()),
                ));
            };
            if placement.block_id != record.id {
                return Err(graph_error(
                    BlockRecordErrorCode::PlacementIdentityMismatch,
                    "Placement key and block_id disagree",
                    Some(record.id.clone()),
                ));
            }
            validate_rank_key(&placement.rank_key, &record.id)?;
            self.validate_parent(record, &placement.parent)?;
        }

        if let Some(orphan) = self
            .placements
            .keys()
            .find(|id| !self.blocks.contains_key(*id))
        {
            return Err(graph_error(
                BlockRecordErrorCode::PlacementIdentityMismatch,
                format!("Placement exists without BlockRecord {orphan}"),
                Some(orphan.clone()),
            ));
        }

        let mut sibling_ranks = BTreeSet::new();
        for placement in self.placements.values() {
            if !sibling_ranks.insert((placement.parent.clone(), placement.rank_key.clone())) {
                return Err(graph_error(
                    BlockRecordErrorCode::DuplicateSiblingRank,
                    format!(
                        "Sibling rank {} is duplicated under {:?}",
                        placement.rank_key, placement.parent
                    ),
                    Some(placement.block_id.clone()),
                ));
            }
        }

        for record in self.blocks.values() {
            self.assert_acyclic_from(&record.id)?;
        }
        Ok(())
    }

    pub fn children(&self, parent: &PlacementParent) -> Vec<&BlockRecord> {
        let mut children = self
            .placements
            .values()
            .filter(|placement| &placement.parent == parent)
            .filter_map(|placement| self.blocks.get(&placement.block_id))
            .collect::<Vec<_>>();
        children.sort_by(|left, right| {
            let left_rank = self
                .placements
                .get(&left.id)
                .expect("validated graph has a placement")
                .rank_key
                .as_str();
            let right_rank = self
                .placements
                .get(&right.id)
                .expect("validated graph has a placement")
                .rank_key
                .as_str();
            left_rank
                .cmp(right_rank)
                .then_with(|| left.id.cmp(&right.id))
        });
        children
    }

    pub fn descendant_ids(&self, root_id: &str) -> Result<Vec<String>, BlockRecordError> {
        self.require_active_block(root_id)?;
        let mut result = Vec::new();
        let mut stack = vec![root_id.to_owned()];
        while let Some(current) = stack.pop() {
            result.push(current.clone());
            let mut children = self
                .placements
                .values()
                .filter(|placement| placement.parent == PlacementParent::Block(current.clone()))
                .map(|placement| placement.block_id.clone())
                .collect::<Vec<_>>();
            children.sort();
            stack.extend(children.into_iter().rev());
        }
        Ok(result)
    }

    pub fn move_block(
        &mut self,
        block_id: &str,
        target_parent: PlacementParent,
        rank_key: impl Into<String>,
    ) -> Result<(), BlockRecordError> {
        let record = self.require_active_block(block_id)?.clone();
        self.validate_target_parent(&record, &target_parent)?;
        let rank_key = rank_key.into();
        validate_rank_key(&rank_key, block_id)?;
        if self.placement(block_id).is_some_and(|placement| {
            placement.parent == target_parent && placement.rank_key == rank_key
        }) {
            return Err(graph_error(
                BlockRecordErrorCode::NoChange,
                format!("Block {block_id} already has the requested placement"),
                Some(block_id.to_owned()),
            ));
        }

        let previous = self.clone();
        let placement = self
            .placements
            .get_mut(block_id)
            .expect("active Block has a placement");
        placement.parent = target_parent;
        placement.rank_key = rank_key;
        placement.revision = placement.revision.checked_add(1).ok_or_else(|| {
            graph_error(
                BlockRecordErrorCode::Overflow,
                "Placement revision overflow",
                Some(block_id.to_owned()),
            )
        })?;
        if let Err(error) = self.validate() {
            *self = previous;
            return Err(error);
        }
        Ok(())
    }

    /// Applies several placement changes against one graph snapshot.  The
    /// complete set is validated only after all edges are installed, which is
    /// necessary for atomic sibling reorders and for moving a parent and one
    /// of its descendants in the same operation.  Revisions are advanced
    /// exactly once for each changed placement.
    pub fn apply_placement_changes(
        &mut self,
        changes: &[PlacementChange],
    ) -> Result<Vec<(BlockPlacement, BlockPlacement)>, BlockRecordError> {
        if changes.is_empty() {
            return Err(graph_error(
                BlockRecordErrorCode::NoChange,
                "Placement change batch is empty",
                None,
            ));
        }
        let previous = self.clone();
        let mut seen = BTreeSet::new();
        let mut deltas = Vec::with_capacity(changes.len());
        for change in changes {
            require_identity(
                &change.block_id,
                BlockRecordErrorCode::EmptyIdentity,
                "block_id",
            )?;
            require_identity(
                &change.rank_key,
                BlockRecordErrorCode::InvalidPlacementRank,
                "rank_key",
            )?;
            if !seen.insert(change.block_id.clone()) {
                return Err(graph_error(
                    BlockRecordErrorCode::DuplicateIdentity,
                    format!("Placement change batch repeats Block {}", change.block_id),
                    Some(change.block_id.clone()),
                ));
            }
            let current = self.require_active_block(&change.block_id)?;
            let previous_placement = self
                .placement(&change.block_id)
                .ok_or_else(|| {
                    graph_error(
                        BlockRecordErrorCode::MissingPlacement,
                        format!("Block {} has no placement", change.block_id),
                        Some(change.block_id.clone()),
                    )
                })?
                .clone();
            if previous_placement.parent == change.parent
                && previous_placement.rank_key == change.rank_key
            {
                return Err(graph_error(
                    BlockRecordErrorCode::NoChange,
                    format!("Block {} already has the requested placement", current.id),
                    Some(current.id.clone()),
                ));
            }
            let next_revision = previous_placement.revision.checked_add(1).ok_or_else(|| {
                graph_error(
                    BlockRecordErrorCode::Overflow,
                    "Placement revision overflow",
                    Some(change.block_id.clone()),
                )
            })?;
            let next_placement = BlockPlacement {
                block_id: change.block_id.clone(),
                parent: change.parent.clone(),
                rank_key: change.rank_key.clone(),
                revision: next_revision,
            };
            self.placements
                .insert(change.block_id.clone(), next_placement.clone());
            deltas.push((previous_placement, next_placement));
        }
        if let Err(error) = self.validate() {
            *self = previous;
            return Err(error);
        }
        Ok(deltas)
    }

    /// Updates the intrinsic identity metadata of an active Block without
    /// changing its ownership placement or content shard.  A type change is
    /// validated against the complete graph so a block cannot become a
    /// leaf-type while retaining children that the new type cannot contain.
    pub fn update_block(
        &mut self,
        block_id: &str,
        kind: BlockKind,
        properties: Value,
    ) -> Result<(), BlockRecordError> {
        let current = self.require_active_block(block_id)?.clone();
        if current.kind == kind && current.properties == properties {
            return Err(graph_error(
                BlockRecordErrorCode::NoChange,
                format!("Block {block_id} already has the requested metadata"),
                Some(block_id.to_owned()),
            ));
        }
        let previous = self.clone();
        let block = self.blocks.get_mut(block_id).expect("active Block exists");
        block.kind = kind;
        block.properties = properties;
        block.revision = block.revision.checked_add(1).ok_or_else(|| {
            graph_error(
                BlockRecordErrorCode::Overflow,
                "Block revision overflow",
                Some(block_id.to_owned()),
            )
        })?;
        if let Err(error) = self.validate() {
            *self = previous;
            return Err(error);
        }
        Ok(())
    }

    /// Removes an active owning subtree from the in-memory graph.  The SQL
    /// adapter archives the returned records in the same transaction; the
    /// graph itself intentionally contains active records only.
    pub fn remove_subtree(&mut self, root_id: &str) -> Result<Vec<BlockRecord>, BlockRecordError> {
        let ids = self.descendant_ids(root_id)?;
        let mut removed = Vec::with_capacity(ids.len());
        for id in ids.iter().rev() {
            let record = self.blocks.remove(id).ok_or_else(|| {
                graph_error(
                    BlockRecordErrorCode::MissingParent,
                    format!("Block {id} disappeared while removing its subtree"),
                    Some(id.clone()),
                )
            })?;
            self.placements.remove(id);
            removed.push(record);
        }
        self.validate()?;
        removed.reverse();
        Ok(removed)
    }

    pub fn promote_to_page(
        &mut self,
        block_id: &str,
        data_source_id: impl Into<String>,
        rank_key: impl Into<String>,
    ) -> Result<(), BlockRecordError> {
        let record = self.require_active_block(block_id)?.clone();
        if !record.kind.can_promote_to_page() {
            return Err(graph_error(
                BlockRecordErrorCode::NotPromotable,
                format!(
                    "Block {} cannot be promoted from {:?} to Page",
                    block_id, record.kind
                ),
                Some(block_id.to_owned()),
            ));
        }
        let previous = self.clone();
        let block = self.blocks.get_mut(block_id).expect("active Block exists");
        block.kind = BlockKind::Page;
        block.revision = block.revision.checked_add(1).ok_or_else(|| {
            graph_error(
                BlockRecordErrorCode::Overflow,
                "Block revision overflow",
                Some(block_id.to_owned()),
            )
        })?;
        if let Err(error) = self.move_block(
            block_id,
            PlacementParent::DataSource(data_source_id.into()),
            rank_key,
        ) {
            *self = previous;
            return Err(error);
        }
        Ok(())
    }

    fn validate_record_identity(&self, record: &BlockRecord) -> Result<(), BlockRecordError> {
        require_identity(&record.id, BlockRecordErrorCode::EmptyIdentity, "block_id")?;
        if record.library_id != self.library_id {
            return Err(graph_error(
                BlockRecordErrorCode::LibraryMismatch,
                format!(
                    "Block {} belongs to Library {}, expected {}",
                    record.id, record.library_id, self.library_id
                ),
                Some(record.id.clone()),
            ));
        }
        if !record.lifecycle.is_active() {
            return Err(graph_error(
                BlockRecordErrorCode::RetiredBlock,
                format!("Block {} is not active", record.id),
                Some(record.id.clone()),
            ));
        }
        require_identity(
            &record.content_shard_id,
            BlockRecordErrorCode::EmptyIdentity,
            "content_shard_id",
        )
    }

    fn validate_parent(
        &self,
        record: &BlockRecord,
        parent: &PlacementParent,
    ) -> Result<(), BlockRecordError> {
        match parent {
            PlacementParent::Library | PlacementParent::DataSource(_) => {
                if matches!(parent, PlacementParent::DataSource(_))
                    && !matches!(record.kind, BlockKind::Page)
                {
                    return Err(graph_error(
                        BlockRecordErrorCode::InvalidParentKind,
                        format!("Only Page Blocks may be directly placed in a Data Source"),
                        Some(record.id.clone()),
                    ));
                }
            }
            PlacementParent::Block(parent_id) => {
                let Some(parent_record) = self.blocks.get(parent_id) else {
                    return Err(graph_error(
                        BlockRecordErrorCode::MissingParent,
                        format!("Parent Block {parent_id} does not exist"),
                        Some(record.id.clone()),
                    ));
                };
                if !parent_record.kind.can_contain_children() {
                    return Err(graph_error(
                        BlockRecordErrorCode::InvalidParentKind,
                        format!("Block {parent_id} cannot contain children"),
                        Some(record.id.clone()),
                    ));
                }
            }
        }
        Ok(())
    }

    fn validate_target_parent(
        &self,
        record: &BlockRecord,
        target_parent: &PlacementParent,
    ) -> Result<(), BlockRecordError> {
        self.validate_parent(record, target_parent)?;
        if let PlacementParent::Block(parent_id) = target_parent {
            if self
                .descendant_ids(&record.id)?
                .iter()
                .any(|id| id == parent_id)
            {
                return Err(graph_error(
                    BlockRecordErrorCode::Cycle,
                    format!(
                        "Cannot move Block {} below its own descendant {}",
                        record.id, parent_id
                    ),
                    Some(record.id.clone()),
                ));
            }
        }
        Ok(())
    }

    fn require_active_block(&self, block_id: &str) -> Result<&BlockRecord, BlockRecordError> {
        let Some(record) = self.blocks.get(block_id) else {
            return Err(graph_error(
                BlockRecordErrorCode::MissingParent,
                format!("Block {block_id} does not exist"),
                Some(block_id.to_owned()),
            ));
        };
        if !record.lifecycle.is_active() {
            return Err(graph_error(
                BlockRecordErrorCode::RetiredBlock,
                format!("Block {block_id} is not active"),
                Some(block_id.to_owned()),
            ));
        }
        Ok(record)
    }

    fn assert_acyclic_from(&self, start_id: &str) -> Result<(), BlockRecordError> {
        let mut visited = BTreeSet::new();
        let mut current = start_id.to_owned();
        loop {
            if !visited.insert(current.clone()) {
                return Err(graph_error(
                    BlockRecordErrorCode::Cycle,
                    format!("Ownership cycle includes Block {current}"),
                    Some(current),
                ));
            }
            let Some(placement) = self.placements.get(&current) else {
                return Err(graph_error(
                    BlockRecordErrorCode::MissingPlacement,
                    format!("Block {current} has no placement"),
                    Some(current),
                ));
            };
            let PlacementParent::Block(parent_id) = &placement.parent else {
                return Ok(());
            };
            current = parent_id.clone();
        }
    }
}

fn validate_rank_key(rank_key: &str, block_id: &str) -> Result<(), BlockRecordError> {
    if rank_key.trim().is_empty() {
        return Err(graph_error(
            BlockRecordErrorCode::InvalidPlacementRank,
            "Placement rank_key cannot be empty",
            Some(block_id.to_owned()),
        ));
    }
    Ok(())
}

fn require_identity(
    value: &str,
    code: BlockRecordErrorCode,
    label: &str,
) -> Result<(), BlockRecordError> {
    if value.trim().is_empty() {
        return Err(graph_error(code, format!("{label} cannot be empty"), None));
    }
    Ok(())
}

fn graph_error(
    code: BlockRecordErrorCode,
    message: impl Into<String>,
    block_id: Option<String>,
) -> BlockRecordError {
    BlockRecordError {
        code,
        message: message.into(),
        block_id,
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn block_kind_uses_one_string_wire_shape_for_builtin_and_custom_kinds() {
        assert_eq!(
            serde_json::to_value(BlockKind::Page).expect("page"),
            json!("page")
        );
        assert_eq!(
            serde_json::to_value(BlockKind::Other("custom".to_owned())).expect("custom"),
            json!("custom")
        );
        assert_eq!(
            serde_json::from_value::<BlockKind>(json!("custom")).expect("decode custom"),
            BlockKind::Other("custom".to_owned())
        );
    }

    fn record(id: &str, kind: BlockKind) -> BlockRecord {
        BlockRecord {
            id: id.to_owned(),
            library_id: "library-a".to_owned(),
            kind,
            lifecycle: BlockLifecycle::Active,
            properties: json!({"id": id}),
            content_shard_id: format!("shard-{}", id.chars().next().unwrap_or('x')),
            revision: 0,
        }
    }

    fn placement(id: &str, parent: PlacementParent, rank_key: impl Into<String>) -> BlockPlacement {
        BlockPlacement {
            block_id: id.to_owned(),
            parent,
            rank_key: rank_key.into(),
            revision: 0,
        }
    }

    #[test]
    fn moving_a_root_only_changes_its_placement() {
        let mut graph = RecordGraph::new("library-a").expect("graph");
        graph
            .insert(
                record("page-a", BlockKind::Page),
                placement("page-a", PlacementParent::Library, "a"),
            )
            .expect("page a");
        graph
            .insert(
                record("page-b", BlockKind::Page),
                placement("page-b", PlacementParent::Library, "b"),
            )
            .expect("page b");
        graph
            .insert(
                record("title-a", BlockKind::Heading),
                placement("title-a", PlacementParent::Block("page-a".to_owned()), "a"),
            )
            .expect("title a");
        for index in 0..100 {
            let id = format!("child-{index:03}");
            graph
                .insert(
                    record(&id, BlockKind::Paragraph),
                    placement(
                        &id,
                        PlacementParent::Block("title-a".to_owned()),
                        format!("{index:03}"),
                    ),
                )
                .expect("child");
        }
        let before_ids = graph.descendant_ids("title-a").expect("subtree");
        let shard_ids = before_ids
            .iter()
            .map(|id| {
                (
                    id.clone(),
                    graph.block(id).expect("record").content_shard_id.clone(),
                )
            })
            .collect::<BTreeMap<_, _>>();

        graph
            .move_block("title-a", PlacementParent::Block("page-b".to_owned()), "a")
            .expect("move root");

        assert_eq!(
            graph.descendant_ids("title-a").expect("subtree"),
            before_ids
        );
        assert_eq!(
            graph.placement("title-a").expect("placement").parent,
            PlacementParent::Block("page-b".to_owned())
        );
        for id in before_ids {
            assert_eq!(
                graph.block(&id).expect("record").content_shard_id,
                shard_ids[&id]
            );
        }
        graph.validate().expect("valid graph");
    }

    #[test]
    fn board_promotion_keeps_the_root_identity_and_descendants() {
        let mut graph = RecordGraph::new("library-a").expect("graph");
        graph
            .insert(
                record("page-a", BlockKind::Page),
                placement("page-a", PlacementParent::Library, "a"),
            )
            .expect("page");
        graph
            .insert(
                record("title-a", BlockKind::Heading),
                placement("title-a", PlacementParent::Block("page-a".to_owned()), "a"),
            )
            .expect("heading");
        graph
            .insert(
                record("child", BlockKind::Paragraph),
                placement("child", PlacementParent::Block("title-a".to_owned()), "a"),
            )
            .expect("child");
        let descendants = graph.descendant_ids("title-a").expect("subtree");
        let shard = graph
            .block("title-a")
            .expect("title")
            .content_shard_id
            .clone();

        graph
            .promote_to_page("title-a", "board-source", "a")
            .expect("promotion");

        assert_eq!(graph.block("title-a").expect("title").kind, BlockKind::Page);
        assert_eq!(
            graph.descendant_ids("title-a").expect("subtree"),
            descendants
        );
        assert_eq!(
            graph.block("title-a").expect("title").content_shard_id,
            shard
        );
        assert_eq!(
            graph.placement("title-a").expect("placement").parent,
            PlacementParent::DataSource("board-source".to_owned())
        );
        graph.validate().expect("valid graph");
    }

    #[test]
    fn moves_reject_cycles_and_invalid_data_source_children() {
        let mut graph = RecordGraph::new("library-a").expect("graph");
        graph
            .insert(
                record("page", BlockKind::Page),
                placement("page", PlacementParent::Library, "a"),
            )
            .expect("page");
        graph
            .insert(
                record("toggle", BlockKind::Toggle),
                placement("toggle", PlacementParent::Block("page".to_owned()), "a"),
            )
            .expect("toggle");
        graph
            .insert(
                record("paragraph", BlockKind::Paragraph),
                placement(
                    "paragraph",
                    PlacementParent::Block("toggle".to_owned()),
                    "a",
                ),
            )
            .expect("paragraph");

        let cycle = graph
            .move_block("page", PlacementParent::Block("toggle".to_owned()), "a")
            .expect_err("cycle");
        assert_eq!(cycle.code, BlockRecordErrorCode::Cycle);

        let invalid = graph
            .move_block(
                "paragraph",
                PlacementParent::DataSource("board".to_owned()),
                "a",
            )
            .expect_err("only pages can be source rows");
        assert_eq!(invalid.code, BlockRecordErrorCode::InvalidParentKind);
    }

    #[test]
    fn children_are_ordered_by_rank_key_then_stable_id() {
        let mut graph = RecordGraph::new("library-a").expect("graph");
        graph
            .insert(
                record("page", BlockKind::Page),
                placement("page", PlacementParent::Library, "a"),
            )
            .expect("page");
        for (id, rank) in [("b", "b"), ("a", "a"), ("c", "c")] {
            graph
                .insert(
                    record(id, BlockKind::Paragraph),
                    placement(id, PlacementParent::Block("page".to_owned()), rank),
                )
                .expect("child");
        }
        let ids = graph
            .children(&PlacementParent::Block("page".to_owned()))
            .into_iter()
            .map(|record| record.id.as_str())
            .collect::<Vec<_>>();
        assert_eq!(ids, ["a", "b", "c"]);
    }
}
