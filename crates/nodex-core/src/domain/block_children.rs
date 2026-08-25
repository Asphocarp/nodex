use std::collections::BTreeMap;
use std::sync::OnceLock;

use serde::Deserialize;

use super::block_tree::{BlockNode, PortableValue};

const MANIFEST: &str =
    include_str!("../../../../src/shared/block-documents/block-children-policy-v1.json");

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
enum BlockChildrenAcceptance {
    Always,
    Never,
    BooleanProp,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BlockChildrenRule {
    acceptance: BlockChildrenAcceptance,
    #[serde(default)]
    prop: Option<String>,
    layout: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BlockChildrenManifest {
    contract_version: u32,
    current: BTreeMap<String, BlockChildrenRule>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct NormalizedBlockForest {
    pub blocks: Vec<BlockNode>,
    pub changed: bool,
    pub lifted_roots: usize,
}

fn rules() -> &'static BTreeMap<String, BlockChildrenRule> {
    static RULES: OnceLock<BTreeMap<String, BlockChildrenRule>> = OnceLock::new();
    RULES.get_or_init(|| {
        let manifest: BlockChildrenManifest =
            serde_json::from_str(MANIFEST).expect("Block children manifest must be valid JSON");
        assert_eq!(
            manifest.contract_version, 1,
            "unsupported Block children contract"
        );
        for (block_type, rule) in &manifest.current {
            match rule.acceptance {
                BlockChildrenAcceptance::BooleanProp => {
                    assert_eq!(rule.prop.as_deref(), Some("isToggleable"));
                }
                BlockChildrenAcceptance::Always | BlockChildrenAcceptance::Never => {
                    assert!(
                        rule.prop.is_none(),
                        "unconditional rule cannot name a property"
                    );
                }
            }
            assert!(
                matches!(
                    rule.layout.as_str(),
                    "indented" | "disclosure" | "enclosed" | "atomic" | "marker" | "resource"
                ),
                "unsupported Block children layout"
            );
            assert!(!block_type.is_empty());
        }
        manifest.current
    })
}

pub fn accepts_block_children(block: &BlockNode) -> bool {
    let rule = rules()
        .get(block.content.name.as_str())
        .unwrap_or_else(|| panic!("unsupported current Block type {}", block.content.name));
    match rule.acceptance {
        BlockChildrenAcceptance::Always => true,
        BlockChildrenAcceptance::Never => false,
        BlockChildrenAcceptance::BooleanProp => rule.prop.as_deref().is_some_and(|prop| {
            block.content.attributes.get(prop) == Some(&PortableValue::Boolean(true))
        }),
    }
}

pub fn normalize_block_children_forest(blocks: Vec<BlockNode>) -> NormalizedBlockForest {
    struct ArenaNode {
        block: BlockNode,
        children: Vec<usize>,
    }

    struct PendingNode {
        block: BlockNode,
        target: Option<usize>,
        rejected_ancestor_depth: usize,
    }

    let mut arena = Vec::<Option<ArenaNode>>::new();
    let mut roots = Vec::<usize>::new();
    let mut pending = blocks
        .into_iter()
        .rev()
        .map(|block| PendingNode {
            block,
            target: None,
            rejected_ancestor_depth: 0,
        })
        .collect::<Vec<_>>();
    let mut lifted_roots = 0_usize;

    while let Some(mut entry) = pending.pop() {
        let can_own_children = accepts_block_children(&entry.block);
        let children = std::mem::take(&mut entry.block.children);
        let arena_index = arena.len();
        arena.push(Some(ArenaNode {
            block: entry.block,
            children: Vec::new(),
        }));
        match entry.target {
            Some(parent_index) => arena[parent_index]
                .as_mut()
                .expect("pending parent")
                .children
                .push(arena_index),
            None => roots.push(arena_index),
        }
        lifted_roots = lifted_roots.saturating_add(entry.rejected_ancestor_depth);

        let child_target = can_own_children.then_some(arena_index).or(entry.target);
        let child_rejected_depth = if can_own_children {
            0
        } else {
            entry.rejected_ancestor_depth.saturating_add(1)
        };
        pending.extend(children.into_iter().rev().map(|block| PendingNode {
            block,
            target: child_target,
            rejected_ancestor_depth: child_rejected_depth,
        }));
    }

    let mut normalized = std::iter::repeat_with(|| None)
        .take(arena.len())
        .collect::<Vec<Option<BlockNode>>>();
    for index in (0..arena.len()).rev() {
        let mut entry = arena[index].take().expect("normalized arena entry");
        entry.block.children = entry
            .children
            .into_iter()
            .map(|child_index| normalized[child_index].take().expect("normalized child"))
            .collect();
        normalized[index] = Some(entry.block);
    }

    let blocks = roots
        .into_iter()
        .map(|index| normalized[index].take().expect("normalized root"))
        .collect();
    NormalizedBlockForest {
        blocks,
        changed: lifted_roots > 0,
        lifted_roots,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::block_tree::{REGISTERED_BLOCK_TYPES, XmlElementNode};

    const NORMALIZATION_FIXTURES: &str =
        include_str!("../../../../src/shared/block-documents/block-children-normalization-v1.json");

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct NormalizationFixtures {
        contract_version: u32,
        cases: Vec<NormalizationFixture>,
    }

    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct NormalizationFixture {
        name: String,
        input: Vec<PortableFixtureBlock>,
        expected: Vec<PortableFixtureBlock>,
        lifted_roots: usize,
    }

    #[derive(Clone, Debug, Deserialize, PartialEq)]
    struct PortableFixtureBlock {
        id: String,
        #[serde(rename = "type")]
        block_type: String,
        props: BTreeMap<String, serde_json::Value>,
        children: Vec<PortableFixtureBlock>,
    }

    fn fixture_block(block: PortableFixtureBlock) -> BlockNode {
        BlockNode {
            id: block.id.clone(),
            container_attributes: [("id".to_owned(), PortableValue::String(block.id))]
                .into_iter()
                .collect(),
            content: XmlElementNode {
                name: block.block_type,
                attributes: block
                    .props
                    .into_iter()
                    .map(|(key, value)| {
                        let value = match value {
                            serde_json::Value::Bool(value) => PortableValue::Boolean(value),
                            other => panic!("unsupported fixture prop {other}"),
                        };
                        (key, value)
                    })
                    .collect(),
                children: Vec::new(),
            },
            children: block.children.into_iter().map(fixture_block).collect(),
        }
    }

    fn portable_block(block: BlockNode) -> PortableFixtureBlock {
        PortableFixtureBlock {
            id: block.id,
            block_type: block.content.name,
            props: block
                .content
                .attributes
                .into_iter()
                .map(|(key, value)| {
                    let value = match value {
                        PortableValue::Boolean(value) => serde_json::Value::Bool(value),
                        other => panic!("unsupported normalized fixture prop {other:?}"),
                    };
                    (key, value)
                })
                .collect(),
            children: block.children.into_iter().map(portable_block).collect(),
        }
    }

    fn block(id: &str, block_type: &str, children: Vec<BlockNode>) -> BlockNode {
        BlockNode {
            id: id.to_owned(),
            container_attributes: BTreeMap::new(),
            content: XmlElementNode {
                name: block_type.to_owned(),
                attributes: BTreeMap::new(),
                children: Vec::new(),
            },
            children,
        }
    }

    #[test]
    fn manifest_covers_the_current_registry_exactly() {
        let manifest_types = rules().keys().map(String::as_str).collect::<Vec<_>>();
        let mut registered_types = REGISTERED_BLOCK_TYPES.to_vec();
        registered_types.sort_unstable();
        assert_eq!(manifest_types, registered_types);
    }

    #[test]
    fn stable_lift_preserves_preorder_and_is_idempotent() {
        let forest = vec![
            block(
                "code",
                "codeBlock",
                vec![block(
                    "image",
                    "image",
                    vec![block("leaf", "paragraph", Vec::new())],
                )],
            ),
            block("after", "paragraph", Vec::new()),
        ];
        let normalized = normalize_block_children_forest(forest);
        assert_eq!(
            normalized
                .blocks
                .iter()
                .map(|block| block.id.as_str())
                .collect::<Vec<_>>(),
            ["code", "image", "leaf", "after"]
        );
        assert!(normalized.changed);
        let second = normalize_block_children_forest(normalized.blocks.clone());
        assert!(!second.changed);
        assert_eq!(second.blocks, normalized.blocks);
    }

    #[test]
    fn normalizes_a_ten_thousand_block_mixed_forest_in_one_pass() {
        let forest = (0..5_000)
            .map(|index| {
                block(
                    &format!("code-{index}"),
                    "codeBlock",
                    vec![block(
                        &format!("paragraph-{index}"),
                        "paragraph",
                        Vec::new(),
                    )],
                )
            })
            .collect::<Vec<_>>();
        let normalized = normalize_block_children_forest(forest);
        assert_eq!(normalized.blocks.len(), 10_000);
        assert_eq!(normalized.lifted_roots, 5_000);
        assert!(
            normalized
                .blocks
                .iter()
                .all(|block| block.children.is_empty())
        );
    }

    #[test]
    fn normalizes_a_ten_thousand_level_forbidden_chain_without_recursion() {
        let mut root = block("content", "paragraph", Vec::new());
        for index in (0..10_000).rev() {
            root = block(&format!("code-{index}"), "codeBlock", vec![root]);
        }

        let normalized = normalize_block_children_forest(vec![root]);

        assert_eq!(normalized.blocks.len(), 10_001);
        assert_eq!(
            normalized.blocks.first().map(|block| block.id.as_str()),
            Some("code-0")
        );
        assert_eq!(
            normalized.blocks.last().map(|block| block.id.as_str()),
            Some("content")
        );
        assert_eq!(normalized.lifted_roots, 50_005_000);
        assert!(
            normalized
                .blocks
                .iter()
                .all(|block| block.children.is_empty())
        );
    }

    #[test]
    fn matches_the_cross_runtime_normalization_fixtures() {
        let fixtures: NormalizationFixtures =
            serde_json::from_str(NORMALIZATION_FIXTURES).expect("normalization fixtures");
        assert_eq!(fixtures.contract_version, 1);
        for fixture in fixtures.cases {
            let normalized = normalize_block_children_forest(
                fixture.input.into_iter().map(fixture_block).collect(),
            );
            assert_eq!(
                normalized.lifted_roots, fixture.lifted_roots,
                "{}",
                fixture.name
            );
            assert_eq!(
                normalized
                    .blocks
                    .into_iter()
                    .map(portable_block)
                    .collect::<Vec<_>>(),
                fixture.expected,
                "{}",
                fixture.name
            );
        }
    }
}
