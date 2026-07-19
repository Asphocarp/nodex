use std::collections::{BTreeSet, HashSet};

use nodex_core_contracts::workspace::{
    ProjectSessionPanelId, ProjectSessionPanelSizePatch, ProjectSessionPanelStatePatch,
};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};

use crate::infrastructure::sqlite::{StoreError, StoreErrorCode};

const LAYOUT_VERSION: u8 = 2;
const MIN_RATIO: f64 = 0.15;
const MAX_RATIO: f64 = 0.85;
const MAX_PANEL_STATE_BYTES: usize = 2 * 1024 * 1024;
const MAX_NODE_DEPTH: usize = 32;
const MAX_NODE_COUNT: usize = 256;
const MAX_NODE_ID_BYTES: usize = 512;
const MAX_PANEL_TABS: usize = 2_048;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PanelLayout {
    version: u8,
    root: PanelNode,
    active_leaf_id: String,
    #[serde(default)]
    mru_leaf_ids: Vec<String>,
    #[serde(default)]
    maximized_leaf_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum PanelNode {
    Leaf {
        id: String,
        #[serde(default, rename = "tabIds")]
        tab_ids: Vec<String>,
        #[serde(default, rename = "activeTabId")]
        active_tab_id: Option<String>,
        #[serde(default, rename = "mruTabIds")]
        mru_tab_ids: Vec<String>,
    },
    Split {
        id: String,
        direction: SplitDirection,
        first: Box<PanelNode>,
        second: Box<PanelNode>,
        ratio: f64,
    },
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum SplitDirection {
    Horizontal,
    Vertical,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PanelState {
    pub(super) collapsed: bool,
    layout: PanelLayout,
    size: Value,
}

#[derive(Clone, Debug, Serialize)]
pub(super) struct PanelStates {
    right: PanelState,
    bottom: PanelState,
}

#[derive(Default)]
struct NormalizeOptions<'a> {
    preferred_active_leaf_id: Option<&'a str>,
    preferred_active_tab_id: Option<&'a str>,
    prune_empty_leaves: bool,
}

struct NormalizeState<'a> {
    known_tab_ids: HashSet<&'a str>,
    seen_tab_ids: HashSet<String>,
    seen_node_ids: HashSet<String>,
    duplicate_index: usize,
    node_count: usize,
}

impl PanelStates {
    pub(super) fn panel(&self, panel_id: ProjectSessionPanelId) -> &PanelState {
        match panel_id {
            ProjectSessionPanelId::Right => &self.right,
            ProjectSessionPanelId::Bottom => &self.bottom,
        }
    }

    pub(super) fn panel_mut(&mut self, panel_id: ProjectSessionPanelId) -> &mut PanelState {
        match panel_id {
            ProjectSessionPanelId::Right => &mut self.right,
            ProjectSessionPanelId::Bottom => &mut self.bottom,
        }
    }

    pub(super) fn replace_layout(
        &mut self,
        panel_id: ProjectSessionPanelId,
        value: &Value,
        tab_ids: &[String],
    ) -> Result<(), StoreError> {
        let layout = parse_layout(value)?;
        self.panel_mut(panel_id).layout =
            normalize_layout(layout, tab_ids, NormalizeOptions::default())?;
        Ok(())
    }

    pub(super) fn patch_state(
        &mut self,
        panel_id: ProjectSessionPanelId,
        patch: &ProjectSessionPanelStatePatch,
    ) -> Result<(), StoreError> {
        let panel = self.panel_mut(panel_id);
        if let Some(collapsed) = patch.collapsed {
            panel.collapsed = collapsed;
        }
        let Some(size_patch) = &patch.size else {
            return Ok(());
        };
        let size = panel
            .size
            .as_object_mut()
            .ok_or_else(|| corrupt("Normalized Project Session panel size is invalid"))?;
        patch_panel_size(size, size_patch)
    }

    pub(super) fn add_tab(
        &mut self,
        panel_id: ProjectSessionPanelId,
        tab_id: &str,
        tab_ids: &[String],
        target_leaf_id: Option<&str>,
        before_tab_id: Option<&str>,
    ) -> Result<(), StoreError> {
        let panel = self.panel_mut(panel_id);
        panel.layout = insert_tab(
            panel.layout.clone(),
            tab_id,
            tab_ids,
            target_leaf_id,
            before_tab_id,
        )?;
        panel.collapsed = false;
        Ok(())
    }

    pub(super) fn activate_tab(
        &mut self,
        panel_id: ProjectSessionPanelId,
        tab_id: &str,
        tab_ids: &[String],
    ) -> Result<(), StoreError> {
        let panel = self.panel_mut(panel_id);
        panel.layout = normalize_layout(
            panel.layout.clone(),
            tab_ids,
            NormalizeOptions {
                preferred_active_tab_id: Some(tab_id),
                ..NormalizeOptions::default()
            },
        )?;
        panel.collapsed = false;
        Ok(())
    }

    pub(super) fn remove_tab(
        &mut self,
        panel_id: ProjectSessionPanelId,
        tab_ids: &[String],
    ) -> Result<(), StoreError> {
        let panel = self.panel_mut(panel_id);
        panel.layout = normalize_layout(
            panel.layout.clone(),
            tab_ids,
            NormalizeOptions {
                prune_empty_leaves: true,
                ..NormalizeOptions::default()
            },
        )?;
        if tab_ids.is_empty() {
            panel.collapsed = true;
        }
        Ok(())
    }

    pub(super) fn set_collapsed(&mut self, panel_id: ProjectSessionPanelId, collapsed: bool) {
        self.panel_mut(panel_id).collapsed = collapsed;
    }

    pub(super) fn ordered_tab_ids(&self, panel_id: ProjectSessionPanelId) -> Vec<String> {
        flatten_tab_ids(&self.panel(panel_id).layout)
    }

    pub(super) fn into_value(self) -> Result<Value, StoreError> {
        serde_json::to_value(self).map_err(|_| internal("Project Session panels cannot be encoded"))
    }
}

fn patch_panel_size(
    size: &mut Map<String, Value>,
    patch: &ProjectSessionPanelSizePatch,
) -> Result<(), StoreError> {
    for (key, value) in [("widthPx", patch.width_px), ("heightPx", patch.height_px)] {
        let Some(value) = value else {
            continue;
        };
        if !value.is_finite() || value <= 0.0 {
            return Err(invalid("Project Session panel size must be positive"));
        }
        let value = serde_json::Number::from_f64(value)
            .map(Value::Number)
            .ok_or_else(|| invalid("Project Session panel size is invalid"))?;
        size.insert(key.to_owned(), value);
    }
    if let Some(full_width) = patch.full_width {
        size.insert("fullWidth".to_owned(), Value::Bool(full_width));
    }
    Ok(())
}

pub(super) fn panel_id_sql(panel_id: ProjectSessionPanelId) -> &'static str {
    match panel_id {
        ProjectSessionPanelId::Right => "right",
        ProjectSessionPanelId::Bottom => "bottom",
    }
}

pub(super) fn parse_panel_id(value: &str) -> Result<ProjectSessionPanelId, StoreError> {
    match value {
        "right" => Ok(ProjectSessionPanelId::Right),
        "bottom" => Ok(ProjectSessionPanelId::Bottom),
        _ => Err(corrupt("Project Session tab panel is invalid")),
    }
}

pub(super) fn parse_panels(
    value: &str,
    right_tab_ids: &[String],
    bottom_tab_ids: &[String],
) -> Result<PanelStates, StoreError> {
    if value.len() > MAX_PANEL_STATE_BYTES {
        return Err(corrupt("Project Session panel state exceeds its bound"));
    }
    let value = serde_json::from_str::<Value>(value)
        .map_err(|_| corrupt("Project Session panel state JSON is invalid"))?;
    let root = value
        .as_object()
        .ok_or_else(|| corrupt("Project Session panel state must be an object"))?;
    Ok(PanelStates {
        right: parse_panel_state(
            root.get("right"),
            ProjectSessionPanelId::Right,
            right_tab_ids,
        )?,
        bottom: parse_panel_state(
            root.get("bottom"),
            ProjectSessionPanelId::Bottom,
            bottom_tab_ids,
        )?,
    })
}

pub(super) fn stringify_panels(panels: PanelStates) -> Result<String, StoreError> {
    let value = panels.into_value()?;
    let encoded = serde_json::to_string(&value)
        .map_err(|_| internal("Project Session panels cannot be encoded"))?;
    if encoded.len() > MAX_PANEL_STATE_BYTES {
        return Err(invalid("Project Session panel state exceeds its bound"));
    }
    Ok(encoded)
}

fn parse_panel_state(
    value: Option<&Value>,
    panel_id: ProjectSessionPanelId,
    tab_ids: &[String],
) -> Result<PanelState, StoreError> {
    let value = value.and_then(Value::as_object);
    let default_collapsed = match panel_id {
        ProjectSessionPanelId::Right => true,
        ProjectSessionPanelId::Bottom => tab_ids.is_empty(),
    };
    let collapsed = value
        .and_then(|value| value.get("collapsed"))
        .and_then(Value::as_bool)
        .unwrap_or(default_collapsed);
    let layout = value
        .and_then(|value| value.get("layout"))
        .and_then(|value| parse_layout(value).ok())
        .unwrap_or_else(|| make_layout(tab_ids, tab_ids.first().map(String::as_str)));
    let layout = normalize_layout(layout, tab_ids, NormalizeOptions::default())?;
    let size = normalize_size(value.and_then(|value| value.get("size")), panel_id);
    Ok(PanelState {
        collapsed,
        layout,
        size,
    })
}

fn normalize_size(value: Option<&Value>, panel_id: ProjectSessionPanelId) -> Value {
    let mut size = match panel_id {
        ProjectSessionPanelId::Right => Map::from_iter([
            ("widthPx".to_owned(), json!(600)),
            ("fullWidth".to_owned(), json!(false)),
        ]),
        ProjectSessionPanelId::Bottom => Map::from_iter([("heightPx".to_owned(), json!(280))]),
    };
    let Some(input) = value.and_then(Value::as_object) else {
        return Value::Object(size);
    };
    for key in ["widthPx", "heightPx"] {
        if let Some(number) = input.get(key).and_then(Value::as_f64)
            && number.is_finite()
            && number > 0.0
        {
            size.insert(key.to_owned(), input[key].clone());
        }
    }
    if let Some(full_width) = input.get("fullWidth").and_then(Value::as_bool) {
        size.insert("fullWidth".to_owned(), Value::Bool(full_width));
    }
    Value::Object(size)
}

fn parse_layout(value: &Value) -> Result<PanelLayout, StoreError> {
    let encoded = serde_json::to_vec(value)
        .map_err(|_| invalid("Project Session panel layout cannot be encoded"))?;
    if encoded.len() > MAX_PANEL_STATE_BYTES {
        return Err(invalid("Project Session panel layout exceeds its bound"));
    }
    let layout = serde_json::from_slice::<PanelLayout>(&encoded)
        .map_err(|_| invalid("Project Session panel layout is invalid"))?;
    if layout.version != LAYOUT_VERSION {
        return Err(invalid(
            "Project Session panel layout version is unsupported",
        ));
    }
    Ok(layout)
}

fn make_layout(tab_ids: &[String], active_tab_id: Option<&str>) -> PanelLayout {
    let tab_ids = unique(tab_ids.iter().cloned());
    let active_tab_id = active_tab_id
        .filter(|candidate| tab_ids.iter().any(|tab_id| tab_id == candidate))
        .map(str::to_owned)
        .or_else(|| tab_ids.first().cloned());
    PanelLayout {
        version: LAYOUT_VERSION,
        root: make_leaf("main".to_owned(), tab_ids, active_tab_id, Vec::new()),
        active_leaf_id: "main".to_owned(),
        mru_leaf_ids: vec!["main".to_owned()],
        maximized_leaf_id: None,
    }
}

fn normalize_layout(
    layout: PanelLayout,
    all_tab_ids: &[String],
    options: NormalizeOptions<'_>,
) -> Result<PanelLayout, StoreError> {
    if all_tab_ids.len() > MAX_PANEL_TABS {
        return Err(invalid("Project Session panel has too many tabs"));
    }
    let all_tab_ids = unique(all_tab_ids.iter().cloned());
    let mut state = NormalizeState {
        known_tab_ids: all_tab_ids.iter().map(String::as_str).collect(),
        seen_tab_ids: HashSet::new(),
        seen_node_ids: HashSet::new(),
        duplicate_index: 0,
        node_count: 0,
    };
    let mut root = normalize_node(layout.root, &mut state, 1)?;
    let initial_leaf_ids = leaf_ids(&root);
    let preferred_from_tab = options
        .preferred_active_tab_id
        .and_then(|tab_id| leaf_id_for_tab(&root, tab_id));
    let active_leaf_id = options
        .preferred_active_leaf_id
        .filter(|leaf_id| {
            initial_leaf_ids
                .iter()
                .any(|candidate| candidate == *leaf_id)
        })
        .map(str::to_owned)
        .or(preferred_from_tab)
        .or_else(|| {
            initial_leaf_ids
                .iter()
                .any(|leaf_id| leaf_id == &layout.active_leaf_id)
                .then_some(layout.active_leaf_id.clone())
        })
        .or_else(|| initial_leaf_ids.first().cloned())
        .unwrap_or_else(|| "main".to_owned());

    let unassigned = all_tab_ids
        .iter()
        .filter(|tab_id| !state.seen_tab_ids.contains(tab_id.as_str()))
        .cloned()
        .collect::<Vec<_>>();
    if !unassigned.is_empty() {
        let leaf = leaf_mut(&mut root, &active_leaf_id)
            .ok_or_else(|| corrupt("Project Session panel has no active leaf"))?;
        append_tabs(leaf, &unassigned, options.preferred_active_tab_id);
    }
    normalize_leaves(&mut root);

    if options.prune_empty_leaves {
        let preserved_leaf_id = if flatten_node_tab_ids(&root).is_empty() {
            active_leaf_id.as_str()
        } else {
            ""
        };
        root = prune_empty(root, preserved_leaf_id)
            .unwrap_or_else(|| make_leaf("main".to_owned(), Vec::new(), None, Vec::new()));
    }

    let leaf_ids = leaf_ids(&root);
    let active_from_tab = options
        .preferred_active_tab_id
        .and_then(|tab_id| leaf_id_for_tab(&root, tab_id));
    let active_leaf_id = active_from_tab
        .or_else(|| {
            leaf_ids
                .iter()
                .any(|leaf_id| leaf_id == &active_leaf_id)
                .then_some(active_leaf_id)
        })
        .or_else(|| leaf_ids.first().cloned())
        .unwrap_or_else(|| "main".to_owned());
    activate_leaf(&mut root, &active_leaf_id, options.preferred_active_tab_id);
    let valid_leaf_ids = leaf_ids.iter().cloned().collect::<HashSet<_>>();
    let mru_leaf_ids = unique(
        std::iter::once(active_leaf_id.clone())
            .chain(layout.mru_leaf_ids)
            .filter(|leaf_id| valid_leaf_ids.contains(leaf_id)),
    );
    let maximized_leaf_id = layout
        .maximized_leaf_id
        .filter(|leaf_id| valid_leaf_ids.contains(leaf_id));
    Ok(PanelLayout {
        version: LAYOUT_VERSION,
        root,
        active_leaf_id,
        mru_leaf_ids,
        maximized_leaf_id,
    })
}

fn normalize_node(
    node: PanelNode,
    state: &mut NormalizeState<'_>,
    depth: usize,
) -> Result<PanelNode, StoreError> {
    state.node_count += 1;
    if depth > MAX_NODE_DEPTH || state.node_count > MAX_NODE_COUNT {
        return Err(invalid("Project Session panel layout is too deeply nested"));
    }
    match node {
        PanelNode::Leaf {
            id,
            tab_ids,
            active_tab_id,
            mru_tab_ids,
        } => {
            let id = normalize_node_id(&id, "leaf", state)?;
            let tab_ids = tab_ids
                .into_iter()
                .filter(|tab_id| {
                    state.known_tab_ids.contains(tab_id.as_str())
                        && state.seen_tab_ids.insert(tab_id.clone())
                })
                .collect::<Vec<_>>();
            Ok(make_leaf(id, tab_ids, active_tab_id, mru_tab_ids))
        }
        PanelNode::Split {
            id,
            direction,
            first,
            second,
            ratio,
        } => {
            let id = normalize_node_id(&id, "split", state)?;
            Ok(PanelNode::Split {
                id,
                direction,
                first: Box::new(normalize_node(*first, state, depth + 1)?),
                second: Box::new(normalize_node(*second, state, depth + 1)?),
                ratio: ratio.clamp(MIN_RATIO, MAX_RATIO),
            })
        }
    }
}

fn normalize_node_id(
    id: &str,
    fallback: &str,
    state: &mut NormalizeState<'_>,
) -> Result<String, StoreError> {
    let base = if id.trim().is_empty() {
        fallback
    } else {
        id.trim()
    };
    if base.len() > MAX_NODE_ID_BYTES || base.chars().any(char::is_control) {
        return Err(invalid("Project Session panel node identity is invalid"));
    }
    let mut candidate = base.to_owned();
    while state.seen_node_ids.contains(&candidate) {
        state.duplicate_index += 1;
        candidate = format!("{base}:{}", state.duplicate_index);
        if candidate.len() > MAX_NODE_ID_BYTES {
            return Err(invalid("Project Session panel node identity is invalid"));
        }
    }
    state.seen_node_ids.insert(candidate.clone());
    Ok(candidate)
}

fn make_leaf(
    id: String,
    tab_ids: Vec<String>,
    active_tab_id: Option<String>,
    mru_tab_ids: Vec<String>,
) -> PanelNode {
    let tab_ids = unique(tab_ids);
    let active_tab_id = active_tab_id
        .filter(|active| tab_ids.contains(active))
        .or_else(|| tab_ids.first().cloned());
    let valid = tab_ids.iter().cloned().collect::<HashSet<_>>();
    let mru_tab_ids = unique(
        active_tab_id
            .iter()
            .cloned()
            .chain(mru_tab_ids)
            .chain(tab_ids.iter().cloned())
            .filter(|tab_id| valid.contains(tab_id)),
    );
    PanelNode::Leaf {
        id,
        tab_ids,
        active_tab_id,
        mru_tab_ids,
    }
}

fn insert_tab(
    layout: PanelLayout,
    tab_id: &str,
    all_tab_ids: &[String],
    target_leaf_id: Option<&str>,
    before_tab_id: Option<&str>,
) -> Result<PanelLayout, StoreError> {
    let mut layout = normalize_layout(
        layout,
        all_tab_ids,
        NormalizeOptions {
            preferred_active_leaf_id: target_leaf_id,
            preferred_active_tab_id: Some(tab_id),
            prune_empty_leaves: false,
        },
    )?;
    remove_tab_from_node(&mut layout.root, tab_id);
    let before_leaf_id = before_tab_id.and_then(|before| leaf_id_for_tab(&layout.root, before));
    if before_tab_id.is_some() && before_leaf_id.is_none() {
        return Err(invalid("before_tab_id is not in the target panel"));
    }
    if let (Some(target), Some(before_leaf)) = (target_leaf_id, before_leaf_id.as_deref())
        && target != before_leaf
    {
        return Err(invalid(
            "target_leaf_id and before_tab_id identify different leaves",
        ));
    }
    let target_leaf_id = target_leaf_id
        .map(str::to_owned)
        .or(before_leaf_id)
        .unwrap_or_else(|| layout.active_leaf_id.clone());
    let leaf = leaf_mut(&mut layout.root, &target_leaf_id)
        .ok_or_else(|| invalid("target_leaf_id is not in the target panel"))?;
    let PanelNode::Leaf {
        tab_ids,
        active_tab_id,
        mru_tab_ids,
        ..
    } = leaf
    else {
        unreachable!("leaf lookup returned a split")
    };
    let index = before_tab_id
        .and_then(|before| tab_ids.iter().position(|candidate| candidate == before))
        .unwrap_or(tab_ids.len());
    tab_ids.insert(index, tab_id.to_owned());
    *active_tab_id = Some(tab_id.to_owned());
    *mru_tab_ids = unique(
        std::iter::once(tab_id.to_owned())
            .chain(mru_tab_ids.iter().cloned())
            .chain(tab_ids.iter().cloned()),
    );
    layout.active_leaf_id = target_leaf_id.clone();
    layout.mru_leaf_ids =
        unique(std::iter::once(target_leaf_id.clone()).chain(layout.mru_leaf_ids));
    layout.maximized_leaf_id = None;
    normalize_layout(
        layout,
        all_tab_ids,
        NormalizeOptions {
            preferred_active_leaf_id: Some(&target_leaf_id),
            preferred_active_tab_id: Some(tab_id),
            prune_empty_leaves: true,
        },
    )
}

fn append_tabs(node: &mut PanelNode, tab_ids: &[String], preferred_active: Option<&str>) {
    let PanelNode::Leaf {
        id,
        tab_ids: existing,
        active_tab_id,
        mru_tab_ids,
        ..
    } = node
    else {
        return;
    };
    existing.extend(tab_ids.iter().cloned());
    if let Some(preferred) =
        preferred_active.filter(|tab_id| tab_ids.iter().any(|id| id == *tab_id))
    {
        *active_tab_id = Some(preferred.to_owned());
    }
    *node = make_leaf(
        id.clone(),
        existing.clone(),
        active_tab_id.clone(),
        mru_tab_ids.clone(),
    );
}

fn normalize_leaves(node: &mut PanelNode) {
    match node {
        PanelNode::Leaf {
            id,
            tab_ids,
            active_tab_id,
            mru_tab_ids,
        } => {
            *node = make_leaf(
                id.clone(),
                tab_ids.clone(),
                active_tab_id.clone(),
                mru_tab_ids.clone(),
            );
        }
        PanelNode::Split { first, second, .. } => {
            normalize_leaves(first);
            normalize_leaves(second);
        }
    }
}

fn activate_leaf(node: &mut PanelNode, leaf_id: &str, preferred_tab_id: Option<&str>) {
    let Some(leaf) = leaf_mut(node, leaf_id) else {
        return;
    };
    let PanelNode::Leaf {
        tab_ids,
        active_tab_id,
        mru_tab_ids,
        ..
    } = leaf
    else {
        return;
    };
    let active = preferred_tab_id
        .filter(|candidate| tab_ids.iter().any(|tab_id| tab_id == *candidate))
        .map(str::to_owned)
        .or_else(|| active_tab_id.clone())
        .or_else(|| tab_ids.first().cloned());
    *active_tab_id = active.clone();
    *mru_tab_ids = unique(
        active
            .into_iter()
            .chain(mru_tab_ids.iter().cloned())
            .chain(tab_ids.iter().cloned()),
    );
}

fn remove_tab_from_node(node: &mut PanelNode, tab_id: &str) {
    match node {
        PanelNode::Leaf {
            id,
            tab_ids,
            active_tab_id,
            mru_tab_ids,
        } => {
            let next_tab_ids = tab_ids
                .iter()
                .filter(|candidate| candidate.as_str() != tab_id)
                .cloned()
                .collect();
            *node = make_leaf(
                id.clone(),
                next_tab_ids,
                active_tab_id.clone(),
                mru_tab_ids.clone(),
            );
        }
        PanelNode::Split { first, second, .. } => {
            remove_tab_from_node(first, tab_id);
            remove_tab_from_node(second, tab_id);
        }
    }
}

fn prune_empty(node: PanelNode, preserved_leaf_id: &str) -> Option<PanelNode> {
    match node {
        PanelNode::Leaf {
            ref id,
            ref tab_ids,
            ..
        } => (!tab_ids.is_empty() || id == preserved_leaf_id).then_some(node),
        PanelNode::Split {
            id,
            direction,
            first,
            second,
            ratio,
        } => match (
            prune_empty(*first, preserved_leaf_id),
            prune_empty(*second, preserved_leaf_id),
        ) {
            (Some(first), Some(second)) => Some(PanelNode::Split {
                id,
                direction,
                first: Box::new(first),
                second: Box::new(second),
                ratio,
            }),
            (Some(node), None) | (None, Some(node)) => Some(node),
            (None, None) => None,
        },
    }
}

fn leaf_ids(node: &PanelNode) -> Vec<String> {
    let mut ids = Vec::new();
    visit_leaves(node, &mut |id, _, _, _| ids.push(id.to_owned()));
    ids
}

fn flatten_tab_ids(layout: &PanelLayout) -> Vec<String> {
    flatten_node_tab_ids(&layout.root)
}

fn flatten_node_tab_ids(node: &PanelNode) -> Vec<String> {
    let mut ids = Vec::new();
    visit_leaves(node, &mut |_, tab_ids, _, _| {
        ids.extend(tab_ids.iter().cloned());
    });
    ids
}

fn leaf_id_for_tab(node: &PanelNode, tab_id: &str) -> Option<String> {
    let mut owner = None;
    visit_leaves(node, &mut |id, tab_ids, _, _| {
        if owner.is_none() && tab_ids.iter().any(|candidate| candidate == tab_id) {
            owner = Some(id.to_owned());
        }
    });
    owner
}

fn visit_leaves(
    node: &PanelNode,
    visit: &mut impl FnMut(&str, &[String], Option<&str>, &[String]),
) {
    match node {
        PanelNode::Leaf {
            id,
            tab_ids,
            active_tab_id,
            mru_tab_ids,
        } => visit(id, tab_ids, active_tab_id.as_deref(), mru_tab_ids),
        PanelNode::Split { first, second, .. } => {
            visit_leaves(first, visit);
            visit_leaves(second, visit);
        }
    }
}

fn leaf_mut<'a>(node: &'a mut PanelNode, leaf_id: &str) -> Option<&'a mut PanelNode> {
    match node {
        PanelNode::Leaf { id, .. } => (id == leaf_id).then_some(node),
        PanelNode::Split { first, second, .. } => {
            leaf_mut(first, leaf_id).or_else(|| leaf_mut(second, leaf_id))
        }
    }
}

fn unique(values: impl IntoIterator<Item = String>) -> Vec<String> {
    let mut seen = BTreeSet::new();
    values
        .into_iter()
        .filter(|value| seen.insert(value.clone()))
        .collect()
}

fn invalid(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::InvalidInput, message, false)
}

fn corrupt(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::StoreCorrupt, message, false)
}

fn internal(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::Internal, message, true)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{PanelStates, ProjectSessionPanelId, parse_panels};

    #[test]
    fn normalizes_duplicate_ownership_and_prunes_empty_leaves_after_removal() {
        let panels = json!({
            "right": {
                "collapsed": false,
                "layout": {
                    "version": 2,
                    "root": {
                        "type": "split",
                        "id": "branch",
                        "direction": "horizontal",
                        "ratio": 0.99,
                        "first": {
                            "type": "leaf",
                            "id": "main",
                            "tabIds": ["one", "two"],
                            "activeTabId": "one",
                            "mruTabIds": ["one", "two"]
                        },
                        "second": {
                            "type": "leaf",
                            "id": "main",
                            "tabIds": ["two", "unknown"],
                            "activeTabId": "two",
                            "mruTabIds": ["two"]
                        }
                    },
                    "activeLeafId": "main",
                    "mruLeafIds": ["main"],
                    "maximizedLeafId": "missing"
                },
                "size": { "widthPx": 720 }
            }
        });
        let mut parsed = parse_panels(
            &panels.to_string(),
            &["one".to_owned(), "two".to_owned(), "three".to_owned()],
            &[],
        )
        .expect("normalize panels");
        let value = parsed.clone().into_value().expect("panels value");
        assert_eq!(value["right"]["layout"]["root"]["ratio"], 0.85);
        assert_eq!(
            parsed.ordered_tab_ids(ProjectSessionPanelId::Right),
            ["one", "two", "three"]
        );
        parsed
            .remove_tab(
                ProjectSessionPanelId::Right,
                &["one".to_owned(), "two".to_owned()],
            )
            .expect("prune empty leaf");
        let value = parsed.into_value().expect("panels value");
        assert_eq!(value["right"]["layout"]["root"]["type"], "leaf");
    }

    #[test]
    fn inserts_before_a_target_tab_and_derives_flat_order() {
        let mut panels =
            parse_panels("{}", &["one".to_owned(), "two".to_owned()], &[]).expect("default panels");
        panels
            .add_tab(
                ProjectSessionPanelId::Right,
                "three",
                &["one".to_owned(), "two".to_owned(), "three".to_owned()],
                None,
                Some("two"),
            )
            .expect("insert tab");
        assert_eq!(
            panels.ordered_tab_ids(ProjectSessionPanelId::Right),
            ["one", "three", "two"]
        );
        assert!(!panels.panel(ProjectSessionPanelId::Right).collapsed);
    }

    #[test]
    fn rejects_an_unknown_explicit_target_leaf() {
        let mut panels = PanelStates::from_value_for_test();
        let error = panels
            .add_tab(
                ProjectSessionPanelId::Right,
                "one",
                &["one".to_owned()],
                Some("missing"),
                None,
            )
            .expect_err("reject missing leaf");
        assert_eq!(
            error.code,
            crate::infrastructure::sqlite::StoreErrorCode::InvalidInput
        );
    }

    impl PanelStates {
        fn from_value_for_test() -> Self {
            parse_panels("{}", &[], &[]).expect("default panels")
        }
    }
}
