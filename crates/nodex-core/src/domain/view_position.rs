use std::collections::{BTreeMap, HashMap, HashSet};

use super::fractional_rank::{
    FractionalRankError, RankedItem, materialize_order, plan as plan_fractional_rank,
};

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct LogicalViewPositionItem {
    pub page_id: String,
    pub rank_key: Option<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum ViewSiblingRankWriteKind {
    Materialize,
    Rebalance,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ViewSiblingRankWrite {
    pub kind: ViewSiblingRankWriteKind,
    pub page_id: String,
    pub rank_key: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ViewPositionRunPlan {
    pub moved_rank_keys: BTreeMap<String, String>,
    pub sibling_writes: Vec<ViewSiblingRankWrite>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ViewPositionPlanError {
    InvalidInput(String),
    AnchorNotFound(String),
    FractionalRank(FractionalRankError),
}

pub fn plan_view_position_run(
    logical_group_order: &[LogicalViewPositionItem],
    moved_page_ids: &[String],
    before_page_id: Option<&str>,
    descending: bool,
) -> Result<ViewPositionRunPlan, ViewPositionPlanError> {
    if moved_page_ids.is_empty() {
        return Err(ViewPositionPlanError::InvalidInput(
            "A View position run requires at least one Page".to_owned(),
        ));
    }
    require_unique(moved_page_ids.iter().map(String::as_str), "Moved Page set")?;
    require_unique(
        logical_group_order.iter().map(|item| item.page_id.as_str()),
        "Logical View group",
    )?;

    let moved = moved_page_ids
        .iter()
        .map(String::as_str)
        .collect::<HashSet<_>>();
    if before_page_id.is_some_and(|page_id| moved.contains(page_id)) {
        return Err(ViewPositionPlanError::InvalidInput(
            "View position anchor must be outside the moved Page set".to_owned(),
        ));
    }
    let remaining = logical_group_order
        .iter()
        .filter(|item| !moved.contains(item.page_id.as_str()))
        .cloned()
        .collect::<Vec<_>>();
    let anchor_index = match before_page_id {
        Some(anchor) => remaining
            .iter()
            .position(|item| item.page_id == anchor)
            .ok_or_else(|| {
                ViewPositionPlanError::AnchorNotFound(format!(
                    "View position anchor does not exist in the target group: {anchor}"
                ))
            })?,
        None => remaining.len(),
    };

    let mut visual_page_ids = remaining
        .iter()
        .map(|item| item.page_id.clone())
        .collect::<Vec<_>>();
    visual_page_ids.splice(anchor_index..anchor_index, moved_page_ids.iter().cloned());
    let mut physical_page_ids = visual_page_ids;
    let mut physical_remaining = remaining.clone();
    let mut physical_moved_page_ids = moved_page_ids.to_vec();
    if descending {
        physical_page_ids.reverse();
        physical_remaining.reverse();
        physical_moved_page_ids.reverse();
    }
    let physical_moved_index = physical_page_ids
        .iter()
        .position(|page_id| moved.contains(page_id.as_str()))
        .ok_or_else(|| {
            ViewPositionPlanError::InvalidInput("Rank plan omitted the moved Page run".to_owned())
        })?;
    let physical_before_page_id = physical_page_ids
        .get(physical_moved_index + physical_moved_page_ids.len())
        .map(String::as_str);

    if remaining.iter().any(|item| item.rank_key.is_none()) {
        return plan_materialized_run(&remaining, moved_page_ids, &physical_page_ids);
    }
    plan_ranked_run(
        &physical_remaining,
        &physical_moved_page_ids,
        physical_before_page_id,
    )
}

fn require_unique<'a>(
    ids: impl Iterator<Item = &'a str>,
    label: &str,
) -> Result<(), ViewPositionPlanError> {
    let mut seen = HashSet::new();
    for id in ids {
        if !seen.insert(id) {
            return Err(ViewPositionPlanError::InvalidInput(format!(
                "{label} must contain unique Page IDs"
            )));
        }
    }
    Ok(())
}

fn plan_materialized_run(
    remaining: &[LogicalViewPositionItem],
    moved_page_ids: &[String],
    physical_page_ids: &[String],
) -> Result<ViewPositionRunPlan, ViewPositionPlanError> {
    let rank_keys =
        materialize_order(physical_page_ids).map_err(ViewPositionPlanError::FractionalRank)?;
    let moved_rank_keys = moved_page_ids
        .iter()
        .map(|page_id| {
            rank_keys
                .get(page_id)
                .cloned()
                .map(|rank_key| (page_id.clone(), rank_key))
                .ok_or_else(|| {
                    ViewPositionPlanError::InvalidInput(format!("Rank plan omitted Page {page_id}"))
                })
        })
        .collect::<Result<BTreeMap<_, _>, _>>()?;
    let sibling_writes = remaining
        .iter()
        .filter_map(|item| {
            let rank_key = rank_keys.get(&item.page_id)?.clone();
            (item.rank_key.as_deref() != Some(rank_key.as_str())).then(|| ViewSiblingRankWrite {
                kind: if item.rank_key.is_none() {
                    ViewSiblingRankWriteKind::Materialize
                } else {
                    ViewSiblingRankWriteKind::Rebalance
                },
                page_id: item.page_id.clone(),
                rank_key,
            })
        })
        .collect();
    Ok(ViewPositionRunPlan {
        moved_rank_keys,
        sibling_writes,
    })
}

fn plan_ranked_run(
    remaining: &[LogicalViewPositionItem],
    moved_page_ids: &[String],
    before_page_id: Option<&str>,
) -> Result<ViewPositionRunPlan, ViewPositionPlanError> {
    let original_ranks = remaining
        .iter()
        .map(|item| {
            item.rank_key
                .clone()
                .map(|rank_key| (item.page_id.clone(), rank_key))
                .ok_or_else(|| {
                    ViewPositionPlanError::InvalidInput(format!(
                        "Ranked order contains unpositioned Page {}",
                        item.page_id
                    ))
                })
        })
        .collect::<Result<Vec<_>, _>>()?;
    let mut effective_ranks = original_ranks.iter().cloned().collect::<HashMap<_, _>>();
    let mut virtual_items = original_ranks
        .iter()
        .map(|(id, rank_key)| RankedItem {
            id: id.clone(),
            rank_key: rank_key.clone(),
        })
        .collect::<Vec<_>>();

    for page_id in moved_page_ids {
        let plan = plan_fractional_rank(&virtual_items, page_id, before_page_id)
            .map_err(ViewPositionPlanError::FractionalRank)?;
        for (sibling_id, rank_key) in plan.rebalanced_rank_keys {
            effective_ranks.insert(sibling_id, rank_key);
        }
        effective_ranks.insert(page_id.clone(), plan.rank_key);
        virtual_items = effective_ranks
            .iter()
            .map(|(id, rank_key)| RankedItem {
                id: id.clone(),
                rank_key: rank_key.clone(),
            })
            .collect();
        virtual_items.sort_by(|left, right| {
            left.rank_key
                .cmp(&right.rank_key)
                .then_with(|| left.id.cmp(&right.id))
        });
    }

    let moved_rank_keys = moved_page_ids
        .iter()
        .map(|page_id| {
            effective_ranks
                .get(page_id)
                .cloned()
                .map(|rank_key| (page_id.clone(), rank_key))
                .ok_or_else(|| {
                    ViewPositionPlanError::InvalidInput(format!("Rank plan omitted Page {page_id}"))
                })
        })
        .collect::<Result<BTreeMap<_, _>, _>>()?;
    let sibling_writes = original_ranks
        .iter()
        .filter_map(|(page_id, original_rank_key)| {
            let rank_key = effective_ranks.get(page_id)?;
            (rank_key != original_rank_key).then(|| ViewSiblingRankWrite {
                kind: ViewSiblingRankWriteKind::Rebalance,
                page_id: page_id.clone(),
                rank_key: rank_key.clone(),
            })
        })
        .collect();
    Ok(ViewPositionRunPlan {
        moved_rank_keys,
        sibling_writes,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ranked(page_id: &str, rank_key: &str) -> LogicalViewPositionItem {
        LogicalViewPositionItem {
            page_id: page_id.to_owned(),
            rank_key: Some(rank_key.to_owned()),
        }
    }

    #[test]
    fn preserves_localized_gaps_for_a_ranked_bulk_append() {
        let items = vec![
            ranked("source", "55555555555555555555555555555555"),
            ranked("anchor", "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
        ];
        let plan = plan_view_position_run(
            &items,
            &["source".to_owned(), "anchor".to_owned()],
            None,
            false,
        )
        .expect("bulk append plan");

        assert_eq!(
            plan.moved_rank_keys["source"],
            "7fffffffffffffffffffffffffffffff"
        );
        assert_eq!(
            plan.moved_rank_keys["anchor"],
            "bfffffffffffffffffffffffffffffff"
        );
        assert!(plan.sibling_writes.is_empty());
    }

    #[test]
    fn materializes_unpositioned_siblings_in_complete_logical_order() {
        let items = vec![
            ranked("positioned", "40000000000000000000000000000000"),
            LogicalViewPositionItem {
                page_id: "unpositioned".to_owned(),
                rank_key: None,
            },
            LogicalViewPositionItem {
                page_id: "moved".to_owned(),
                rank_key: None,
            },
        ];
        let plan =
            plan_view_position_run(&items, &["moved".to_owned()], Some("unpositioned"), false)
                .expect("materialized plan");

        assert_eq!(
            plan.sibling_writes
                .iter()
                .filter(|write| write.kind == ViewSiblingRankWriteKind::Materialize)
                .count(),
            1
        );
    }
}
