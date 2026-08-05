use std::collections::{BTreeMap, BTreeSet};

use nodex_core_contracts::collection::{CollectionWindowAuthority, CollectionWindowRequest};
use nodex_core_contracts::database::{
    DatabasePagePropertyAddress, DatabaseRelationCandidate, DatabaseRelationTargetItem,
    DatabaseRelationTargetWindow, DatabaseRelationValuePreview, DatabaseRowSummary,
};
use rusqlite::{Connection, OptionalExtension, params};
use serde_json::{Value, json};

use crate::infrastructure::sqlite::{StoreError, StoreErrorCode};
use crate::infrastructure::{
    collection_window::{WindowCandidate, assemble, normalize_request},
    cursor::{self, CollectionCursorSubject, CursorDirection, KeysetCoordinate, KeysetValue},
};

pub(crate) const MAX_RELATION_TARGETS: usize = 10_000;
pub(crate) const MAX_RELATION_PATCH_TARGETS: usize = 100;
pub(crate) const MAX_RELATION_WINDOW: usize = 100;
pub(crate) const RELATION_PREVIEW_TARGETS: usize = 3;
const MAX_RELATION_CANDIDATE_QUERY_BYTES: usize = 512;

pub(crate) enum RelationValueEdit<'a> {
    Replace {
        expected_value_revision: i64,
        page_ids: &'a [String],
    },
    Patch {
        add_page_ids: &'a [String],
        remove_page_ids: &'a [String],
    },
}

pub(crate) struct RelationMutationOutcome {
    pub membership_id: String,
    pub value_revision: i64,
    pub changed: bool,
}

pub(crate) fn target_data_source_id(
    connection: &Connection,
    data_source_id: &str,
    property_id: &str,
) -> Result<String, StoreError> {
    connection
        .query_row(
            "SELECT relation.target_data_source_id \
             FROM data_source_relation_properties relation \
             JOIN data_source_properties property \
               ON property.data_source_id = relation.data_source_id \
               AND property.id = relation.property_id \
             WHERE relation.data_source_id = ?1 AND relation.property_id = ?2 \
               AND property.value_type = 'relation' AND property.lifecycle = 'active'",
            params![data_source_id, property_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .ok_or_else(|| not_found("Relation Property is unavailable"))
}

pub(crate) fn apply_value_edit(
    connection: &Connection,
    library_id: &str,
    project_id: Option<&str>,
    address: &DatabasePagePropertyAddress,
    edit: RelationValueEdit<'_>,
    now: &str,
) -> Result<RelationMutationOutcome, StoreError> {
    let DatabasePagePropertyAddress {
        page_id,
        data_source_id,
        property_id,
    } = address;
    let target_data_source_id = target_data_source_id(connection, data_source_id, property_id)?;
    let membership_id = connection
        .query_row(
            "SELECT membership.id \
             FROM data_source_page_memberships membership \
             JOIN pages page ON page.block_id = membership.page_block_id \
             JOIN blocks block ON block.id = page.block_id \
             WHERE membership.data_source_id = ?1 AND membership.page_block_id = ?2 \
               AND membership.removed_at IS NULL \
               AND page.parent_kind = 'data_source' AND page.parent_id = ?1 \
               AND page.lifecycle = 'active' AND block.lifecycle = 'active'",
            params![data_source_id, page_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .ok_or_else(|| not_found("Page is not an active row in the Data Source"))?;
    let current_revision = connection
        .query_row(
            "SELECT revision FROM data_source_property_values \
             WHERE data_source_id = ?1 AND membership_id = ?2 AND property_id = ?3 \
               AND value_type = 'relation' AND json_type(value_json) = 'null'",
            params![data_source_id, membership_id, property_id],
            |row| row.get::<_, i64>(0),
        )
        .optional()?
        .unwrap_or(0);
    let current = connection
        .prepare(
            "SELECT target_page_block_id FROM data_source_relation_edges \
             WHERE source_data_source_id = ?1 AND source_membership_id = ?2 \
               AND property_id = ?3 ORDER BY target_page_block_id",
        )?
        .query_map(params![data_source_id, membership_id, property_id], |row| {
            row.get::<_, String>(0)
        })?
        .collect::<rusqlite::Result<BTreeSet<_>>>()?;

    let (desired, targets_requiring_read_access) = match edit {
        RelationValueEdit::Replace {
            expected_value_revision,
            page_ids,
        } => {
            require_revision(expected_value_revision, current_revision)?;
            let desired = canonical_targets(page_ids, "Relation replacement")?;
            let targets_requiring_read_access = if desired.is_empty() {
                BTreeSet::new()
            } else {
                desired.clone()
            };
            (desired, targets_requiring_read_access)
        }
        RelationValueEdit::Patch {
            add_page_ids,
            remove_page_ids,
        } => {
            if add_page_ids.len() + remove_page_ids.len() > MAX_RELATION_PATCH_TARGETS {
                return Err(resource_exhausted(format!(
                    "Relation patch exceeds {MAX_RELATION_PATCH_TARGETS} targets"
                )));
            }
            let add = canonical_targets(add_page_ids, "Relation add set")?;
            let remove = canonical_targets(remove_page_ids, "Relation remove set")?;
            if add.iter().any(|page_id| remove.contains(page_id)) {
                return Err(invalid("Relation add/remove sets must not overlap"));
            }
            let mut desired = current.clone();
            desired.extend(add.clone());
            desired.retain(|page_id| !remove.contains(page_id));
            let targets_requiring_read_access = add.union(&remove).cloned().collect();
            (desired, targets_requiring_read_access)
        }
    };
    if desired.len() > MAX_RELATION_TARGETS {
        return Err(resource_exhausted(format!(
            "Relation value exceeds {MAX_RELATION_TARGETS} targets"
        )));
    }
    validate_readable_targets(
        connection,
        library_id,
        project_id,
        &target_data_source_id,
        &targets_requiring_read_access,
    )?;
    if desired == current {
        return Ok(RelationMutationOutcome {
            membership_id,
            value_revision: current_revision,
            changed: false,
        });
    }
    let additions = desired.difference(&current).cloned().collect::<Vec<_>>();
    validate_active_targets(connection, &target_data_source_id, &additions)?;

    let next_revision = current_revision + 1;
    connection.execute(
        "INSERT INTO data_source_property_values(\
           data_source_id, membership_id, property_id, value_type, value_json, revision, updated_at\
         ) VALUES (?1, ?2, ?3, 'relation', 'null', ?4, ?5) \
         ON CONFLICT(data_source_id, membership_id, property_id) DO UPDATE SET \
           value_type = 'relation', value_json = 'null', revision = excluded.revision, \
           updated_at = excluded.updated_at",
        params![
            data_source_id,
            membership_id,
            property_id,
            next_revision,
            now
        ],
    )?;
    let mut delete = connection.prepare(
        "DELETE FROM data_source_relation_edges \
         WHERE source_data_source_id = ?1 AND source_membership_id = ?2 \
           AND property_id = ?3 AND target_page_block_id = ?4",
    )?;
    for target_page_id in current.difference(&desired) {
        delete.execute(params![
            data_source_id,
            membership_id,
            property_id,
            target_page_id
        ])?;
    }
    drop(delete);
    let mut insert = connection.prepare(
        "INSERT INTO data_source_relation_edges(\
           source_data_source_id, source_membership_id, property_id, \
           target_page_block_id, created_at\
         ) VALUES (?1, ?2, ?3, ?4, ?5)",
    )?;
    for target_page_id in additions {
        insert.execute(params![
            data_source_id,
            membership_id,
            property_id,
            target_page_id,
            now
        ])?;
    }
    Ok(RelationMutationOutcome {
        membership_id,
        value_revision: next_revision,
        changed: true,
    })
}

fn canonical_targets(values: &[String], label: &str) -> Result<BTreeSet<String>, StoreError> {
    if values.len() > MAX_RELATION_TARGETS {
        return Err(resource_exhausted(format!(
            "{label} exceeds {MAX_RELATION_TARGETS} targets"
        )));
    }
    let mut targets = BTreeSet::new();
    for value in values {
        if value.is_empty()
            || value.len() > 512
            || value != value.trim()
            || value.chars().any(char::is_control)
        {
            return Err(invalid(format!(
                "{label} contains an invalid Page identity"
            )));
        }
        if !targets.insert(value.clone()) {
            return Err(invalid(format!(
                "{label} contains a duplicate Page identity"
            )));
        }
    }
    Ok(targets)
}

pub(crate) fn target_window(
    connection: &Connection,
    library_id: &str,
    commit_head: i64,
    project_id: Option<&str>,
    address: &DatabasePagePropertyAddress,
    request: &CollectionWindowRequest,
) -> Result<DatabaseRelationTargetWindow, StoreError> {
    let normalized = normalize_request(request)?;
    if normalized.first > MAX_RELATION_WINDOW {
        return Err(invalid(format!(
            "Relation window cannot exceed {MAX_RELATION_WINDOW} targets"
        )));
    }
    let membership_id =
        active_membership_id(connection, &address.data_source_id, &address.page_id)?;
    let target_source =
        target_data_source_id(connection, &address.data_source_id, &address.property_id)?;
    let value_revision = value_revision(
        connection,
        &address.data_source_id,
        &membership_id,
        &address.property_id,
    )?;
    let total_count = connection.query_row(
        "SELECT count(*) FROM data_source_relation_edges \
         WHERE source_data_source_id = ?1 AND source_membership_id = ?2 \
           AND property_id = ?3",
        params![address.data_source_id, membership_id, address.property_id],
        |row| row.get::<_, i64>(0),
    )?;
    let fingerprint = cursor::query_fingerprint(&(
        "database_relation_target_window_v1",
        &address.page_id,
        &address.data_source_id,
        &address.property_id,
        value_revision,
    ))?;
    let subject = CollectionCursorSubject {
        kind: "database_relation_targets",
        library_id,
        query_fingerprint: &fingerprint,
    };
    let after_ordinal = normalized
        .after
        .map(|encoded| cursor::decode(connection, encoded, subject))
        .transpose()?
        .map(|(direction, coordinate)| {
            let [KeysetValue::Integer { value: ordinal }] = coordinate.values.as_slice() else {
                return Err(invalid("Relation cursor is incompatible"));
            };
            if direction != CursorDirection::Forward
                || coordinate.stable_id != "relation_target"
                || *ordinal < 0
            {
                return Err(invalid("Relation cursor is incompatible"));
            }
            Ok(*ordinal)
        })
        .transpose()?;
    let mut statement = connection.prepare(
        "WITH ranked AS (\
           SELECT target_page_block_id, \
             row_number() OVER (ORDER BY target_page_block_id) AS ordinal \
           FROM data_source_relation_edges \
           WHERE source_data_source_id = ?1 AND source_membership_id = ?2 \
             AND property_id = ?3\
         ) \
         SELECT target_page_block_id, ordinal FROM ranked \
         WHERE ordinal > COALESCE(?4, 0) ORDER BY ordinal LIMIT ?5",
    )?;
    let targets_with_ordinals = statement
        .query_map(
            params![
                address.data_source_id,
                membership_id,
                address.property_id,
                after_ordinal,
                i64::try_from(normalized.first + 1)
                    .map_err(|_| invalid("Relation window size is invalid"))?
            ],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
        )?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let target_keys = targets_with_ordinals
        .iter()
        .map(|(page_id, _)| (target_source.clone(), page_id.clone()))
        .collect::<BTreeSet<_>>();
    let projected = project_targets(connection, library_id, project_id, &target_keys)?;
    let candidates = targets_with_ordinals
        .into_iter()
        .map(|(page_id, ordinal)| {
            let item = projected
                .get(&(target_source.clone(), page_id.clone()))
                .cloned()
                .unwrap_or(DatabaseRelationTargetItem::Restricted);
            Ok(WindowCandidate {
                item,
                coordinate: KeysetCoordinate {
                    values: vec![KeysetValue::Integer { value: ordinal }],
                    stable_id: "relation_target".to_owned(),
                },
            })
        })
        .collect::<Result<Vec<_>, StoreError>>()?;
    let targets = assemble(
        candidates,
        normalized.first,
        CollectionWindowAuthority {
            projection_revision: commit_head,
        },
        |coordinate| {
            cursor::mint(
                connection,
                subject,
                CursorDirection::Forward,
                coordinate.clone(),
            )
        },
    )?;
    Ok(DatabaseRelationTargetWindow {
        value_revision,
        total_count,
        targets,
    })
}

pub(crate) fn candidate_window(
    connection: &Connection,
    library_id: &str,
    commit_head: i64,
    target_data_source_id: &str,
    filter: Option<&Value>,
    request: &CollectionWindowRequest,
) -> Result<nodex_core_contracts::collection::CollectionWindow<DatabaseRelationCandidate>, StoreError>
{
    let normalized = normalize_request(request)?;
    if normalized.first > MAX_RELATION_WINDOW {
        return Err(invalid(format!(
            "Relation candidate window cannot exceed {MAX_RELATION_WINDOW} Pages"
        )));
    }
    let query = match filter {
        None | Some(Value::Null) => String::new(),
        Some(Value::Object(filter)) if filter.keys().all(|key| key == "query") => filter
            .get("query")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase(),
        _ => return Err(invalid("Relation candidate filter must contain only query")),
    };
    if query.len() > MAX_RELATION_CANDIDATE_QUERY_BYTES {
        return Err(invalid("Relation candidate query is too long"));
    }
    let fingerprint = cursor::query_fingerprint(&(
        "database_relation_candidate_window_v1",
        target_data_source_id,
        &query,
    ))?;
    let subject = CollectionCursorSubject {
        kind: "database_relation_candidates",
        library_id,
        query_fingerprint: &fingerprint,
    };
    let after = normalized
        .after
        .map(|encoded| cursor::decode(connection, encoded, subject))
        .transpose()?
        .map(|(direction, coordinate)| {
            let [KeysetValue::Text { value: title }] = coordinate.values.as_slice() else {
                return Err(invalid("Relation candidate cursor is incompatible"));
            };
            if direction != CursorDirection::Forward {
                return Err(invalid("Relation candidate cursor is incompatible"));
            }
            Ok((title.clone(), coordinate.stable_id))
        })
        .transpose()?;
    let (after_title, after_page_id) = after
        .map(|(title, page_id)| (Some(title), Some(page_id)))
        .unwrap_or((None, None));
    let query_limit = i64::try_from(normalized.first.saturating_add(1))
        .map_err(|_| invalid("Relation candidate window size is invalid"))?;
    let candidates = connection
        .prepare(
            "SELECT membership.page_block_id, model.title, lower(model.title) \
             FROM data_source_page_memberships membership \
             JOIN pages page ON page.block_id = membership.page_block_id \
             JOIN blocks block ON block.id = page.block_id \
             JOIN page_read_model model ON model.page_block_id = page.block_id \
             WHERE membership.data_source_id = ?1 AND membership.removed_at IS NULL \
               AND page.parent_kind = 'data_source' AND page.parent_id = ?1 \
               AND page.lifecycle = 'active' AND block.lifecycle = 'active' \
               AND (?2 = '' OR instr(lower(model.title), ?2) > 0) \
               AND (?3 IS NULL OR lower(model.title) > ?3 \
                 OR (lower(model.title) = ?3 AND membership.page_block_id > ?4)) \
             ORDER BY lower(model.title), membership.page_block_id LIMIT ?5",
        )?
        .query_map(
            params![
                target_data_source_id,
                query,
                after_title,
                after_page_id,
                query_limit
            ],
            |row| {
                let page_id = row.get::<_, String>(0)?;
                let title = row.get::<_, String>(1)?;
                let normalized_title = row.get::<_, String>(2)?;
                Ok(WindowCandidate {
                    item: DatabaseRelationCandidate {
                        page_id: page_id.clone(),
                        title,
                    },
                    coordinate: KeysetCoordinate {
                        values: vec![KeysetValue::Text {
                            value: normalized_title,
                        }],
                        stable_id: page_id,
                    },
                })
            },
        )?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    assemble(
        candidates,
        normalized.first,
        CollectionWindowAuthority {
            projection_revision: commit_head,
        },
        |coordinate| {
            cursor::mint(
                connection,
                subject,
                CursorDirection::Forward,
                coordinate.clone(),
            )
        },
    )
}

pub(crate) fn hydrate_row_previews(
    connection: &Connection,
    library_id: &str,
    project_id: Option<&str>,
    data_source_id: &str,
    rows: &mut [DatabaseRowSummary],
) -> Result<(), StoreError> {
    if rows.is_empty() {
        return Ok(());
    }
    let memberships = rows
        .iter()
        .map(|row| row.membership_id.as_str())
        .collect::<Vec<_>>();
    let memberships_json = serde_json::to_string(&memberships)
        .map_err(|_| internal("Relation preview memberships cannot encode"))?;
    let relation_properties = connection
        .prepare(
            "SELECT property_id, target_data_source_id \
             FROM data_source_relation_properties WHERE data_source_id = ?1",
        )?
        .query_map([data_source_id], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?
        .collect::<rusqlite::Result<BTreeMap<_, _>>>()?;
    if relation_properties.is_empty() {
        return Ok(());
    }
    let mut statement = connection.prepare(
        "WITH ranked AS (\
           SELECT edge.source_membership_id, edge.property_id, edge.target_page_block_id, \
             count(*) OVER (\
               PARTITION BY edge.source_membership_id, edge.property_id\
             ) AS total_count \
           FROM data_source_relation_edges edge \
           JOIN json_each(?2) candidate ON candidate.value = edge.source_membership_id \
           WHERE edge.source_data_source_id = ?1\
         ) \
         SELECT value.membership_id, value.property_id, value.revision, \
           ranked.target_page_block_id, COALESCE(ranked.total_count, 0) \
         FROM data_source_property_values value \
         JOIN json_each(?2) candidate ON candidate.value = value.membership_id \
         LEFT JOIN ranked ON ranked.source_membership_id = value.membership_id \
           AND ranked.property_id = value.property_id \
         WHERE value.data_source_id = ?1 AND value.value_type = 'relation' \
         ORDER BY value.membership_id, value.property_id, ranked.target_page_block_id",
    )?;
    let records = statement
        .query_map(params![data_source_id, memberships_json], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, i64>(4)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let target_keys = records
        .iter()
        .filter_map(|(_, property_id, _, target_page_id, _)| {
            let target_page_id = target_page_id.as_ref()?;
            relation_properties
                .get(property_id)
                .map(|target_source| (target_source.clone(), target_page_id.clone()))
        })
        .collect::<BTreeSet<_>>();
    let projected = project_targets(connection, library_id, project_id, &target_keys)?;
    let mut previews = BTreeMap::<(String, String), DatabaseRelationValuePreview>::new();
    for (membership_id, property_id, revision, target_page_id, total_count) in records {
        let preview = previews
            .entry((membership_id, property_id.clone()))
            .or_insert_with(|| DatabaseRelationValuePreview {
                value_revision: revision,
                total_count,
                targets: Vec::new(),
                restricted_count: 0,
                has_more: false,
            });
        let Some(target_page_id) = target_page_id else {
            continue;
        };
        let target_source = relation_properties
            .get(&property_id)
            .ok_or_else(|| corrupt("Relation preview has no definition"))?;
        let target = projected
            .get(&(target_source.clone(), target_page_id))
            .cloned()
            .unwrap_or(DatabaseRelationTargetItem::Restricted);
        match target {
            DatabaseRelationTargetItem::Restricted => preview.restricted_count += 1,
            visible if preview.targets.len() < RELATION_PREVIEW_TARGETS => {
                preview.targets.push(visible);
            }
            _ => {}
        }
        preview.has_more = preview.total_count
            > i64::try_from(preview.targets.len())
                .map_err(|_| internal("Relation preview size overflowed"))?;
    }
    for row in rows {
        let membership_id = row.membership_id.clone();
        for property_id in relation_properties.keys() {
            let Some(preview) = previews.remove(&(membership_id.clone(), property_id.clone()))
            else {
                continue;
            };
            row.database_values.insert(
                property_id.clone(),
                json!({
                    "kind": "relation",
                    "value": preview,
                }),
            );
        }
    }
    Ok(())
}

pub(crate) fn hydrate_projection_values(
    connection: &Connection,
    library_id: &str,
    project_id: Option<&str>,
    data_source_id: &str,
    membership_id: &str,
    values: &mut BTreeMap<String, Value>,
) -> Result<(), StoreError> {
    let records = connection
        .prepare(
            "SELECT relation.property_id, relation.target_data_source_id, value.revision, \
               edge.target_page_block_id \
             FROM data_source_relation_properties relation \
             JOIN data_source_property_values value \
               ON value.data_source_id = relation.data_source_id \
               AND value.membership_id = ?2 AND value.property_id = relation.property_id \
             LEFT JOIN data_source_relation_edges edge \
               ON edge.source_data_source_id = relation.data_source_id \
               AND edge.source_membership_id = value.membership_id \
               AND edge.property_id = relation.property_id \
             WHERE relation.data_source_id = ?1 ORDER BY relation.property_id",
        )?
        .query_map(params![data_source_id, membership_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut previews = BTreeMap::<String, (String, i64, Vec<String>)>::new();
    let mut target_keys = BTreeSet::new();
    for (property_id, target_source, value_revision, target_page_id) in records {
        let preview = previews
            .entry(property_id)
            .or_insert_with(|| (target_source.clone(), value_revision, Vec::new()));
        let Some(target_page_id) = target_page_id else {
            continue;
        };
        target_keys.insert((target_source, target_page_id.clone()));
        preview.2.push(target_page_id);
    }
    let projected = project_targets(connection, library_id, project_id, &target_keys)?;
    for (property_id, (target_source, value_revision, target_ids)) in previews {
        let total_count = i64::try_from(target_ids.len())
            .map_err(|_| internal("Relation target count overflowed"))?;
        let mut targets = Vec::new();
        let mut restricted_count = 0_i64;
        for page_id in target_ids {
            match projected
                .get(&(target_source.clone(), page_id))
                .cloned()
                .unwrap_or(DatabaseRelationTargetItem::Restricted)
            {
                DatabaseRelationTargetItem::Restricted => restricted_count += 1,
                visible if targets.len() < RELATION_PREVIEW_TARGETS => targets.push(visible),
                _ => {}
            }
        }
        let preview = DatabaseRelationValuePreview {
            value_revision,
            total_count,
            targets,
            restricted_count,
            has_more: total_count
                > i64::try_from(RELATION_PREVIEW_TARGETS)
                    .map_err(|_| internal("Relation preview bound is invalid"))?
                || restricted_count > 0,
        };
        let record = values
            .get_mut(&property_id)
            .and_then(Value::as_object_mut)
            .ok_or_else(|| corrupt("Relation value header projection is missing"))?;
        record.insert(
            "value".to_owned(),
            json!({ "kind": "relation", "value": preview }),
        );
    }
    Ok(())
}

fn active_membership_id(
    connection: &Connection,
    data_source_id: &str,
    page_id: &str,
) -> Result<String, StoreError> {
    connection
        .query_row(
            "SELECT membership.id FROM data_source_page_memberships membership \
             JOIN pages page ON page.block_id = membership.page_block_id \
             WHERE membership.data_source_id = ?1 AND membership.page_block_id = ?2 \
               AND membership.removed_at IS NULL AND page.parent_kind = 'data_source' \
               AND page.parent_id = ?1 AND page.lifecycle = 'active'",
            params![data_source_id, page_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?
        .ok_or_else(|| not_found("Page is not an active row in the Data Source"))
}

fn value_revision(
    connection: &Connection,
    data_source_id: &str,
    membership_id: &str,
    property_id: &str,
) -> Result<i64, StoreError> {
    Ok(connection
        .query_row(
            "SELECT revision FROM data_source_property_values \
             WHERE data_source_id = ?1 AND membership_id = ?2 AND property_id = ?3 \
               AND value_type = 'relation'",
            params![data_source_id, membership_id, property_id],
            |row| row.get::<_, i64>(0),
        )
        .optional()?
        .unwrap_or(0))
}

fn project_targets(
    connection: &Connection,
    library_id: &str,
    project_id: Option<&str>,
    targets: &BTreeSet<(String, String)>,
) -> Result<BTreeMap<(String, String), DatabaseRelationTargetItem>, StoreError> {
    if targets.is_empty() {
        return Ok(BTreeMap::new());
    }
    let candidates = targets
        .iter()
        .map(|(target_source_id, page_id)| {
            json!({ "targetSourceId": target_source_id, "pageId": page_id })
        })
        .collect::<Vec<_>>();
    let candidates_json = serde_json::to_string(&candidates)
        .map_err(|_| internal("Relation target candidates cannot encode"))?;
    let mut statement = connection.prepare(
        "WITH RECURSIVE \
         candidate(target_source_id, page_id) AS (\
           SELECT json_extract(value, '$.targetSourceId'), json_extract(value, '$.pageId') \
           FROM json_each(?1)\
         ), \
         ancestors(target_source_id, root_page_id, page_id, parent_kind, parent_id, path) AS (\
           SELECT candidate.target_source_id, candidate.page_id, page.block_id, \
             page.parent_kind, page.parent_id, '|' || page.block_id || '|' \
           FROM candidate JOIN pages page ON page.block_id = candidate.page_id \
             AND page.library_id = ?2 \
           UNION ALL \
           SELECT ancestors.target_source_id, ancestors.root_page_id, parent.block_id, \
             parent.parent_kind, parent.parent_id, ancestors.path || parent.block_id || '|' \
           FROM ancestors JOIN pages parent ON ancestors.parent_kind = 'page' \
             AND parent.block_id = ancestors.parent_id AND parent.library_id = ?2 \
           WHERE instr(ancestors.path, '|' || parent.block_id || '|') = 0\
         ) \
         SELECT candidate.target_source_id, candidate.page_id, page.lifecycle, \
           materialization.title, \
           EXISTS(SELECT 1 FROM data_source_page_memberships membership \
             WHERE membership.data_source_id = candidate.target_source_id \
               AND membership.page_block_id = candidate.page_id \
               AND membership.removed_at IS NULL), \
           COALESCE(CASE WHEN ?3 IS NULL THEN 1 ELSE \
             EXISTS(SELECT 1 FROM projects project \
               WHERE project.id = ?3 AND project.library_id = ?2) \
             AND (\
               block.project_id = ?3 \
               OR EXISTS(\
                 SELECT 1 FROM ancestors terminal \
                 JOIN data_sources source ON terminal.parent_kind = 'data_source' \
                   AND source.id = terminal.parent_id AND source.library_id = ?2 \
                 JOIN projects project ON project.id = ?3 AND project.library_id = ?2 \
                 WHERE terminal.target_source_id = candidate.target_source_id \
                   AND terminal.root_page_id = candidate.page_id \
                   AND (source.home_database_block_id = project.database_block_id \
                     OR EXISTS(SELECT 1 FROM project_resource_grants grant_row \
                       WHERE grant_row.project_id = ?3 AND grant_row.root_kind = 'database' \
                         AND grant_row.root_id = source.home_database_block_id \
                         AND grant_row.lifecycle = 'active'))\
               ) \
               OR EXISTS(\
                 SELECT 1 FROM ancestors ancestor \
                 JOIN project_resource_grants grant_row \
                   ON grant_row.project_id = ?3 AND grant_row.root_kind = 'page' \
                   AND grant_row.root_id = ancestor.page_id AND grant_row.lifecycle = 'active' \
                 WHERE ancestor.target_source_id = candidate.target_source_id \
                   AND ancestor.root_page_id = candidate.page_id\
               )\
             ) END, 0) \
         FROM candidate \
         LEFT JOIN pages page ON page.block_id = candidate.page_id AND page.library_id = ?2 \
         LEFT JOIN blocks block ON block.id = page.block_id AND block.type = 'page' \
         LEFT JOIN documents document ON document.id = page.document_id \
         LEFT JOIN document_materializations materialization \
           ON materialization.document_id = document.id \
           AND materialization.generation = document.generation \
           AND materialization.projected_seq = document.head_seq \
           AND materialization.schema_version = document.schema_version",
    )?;
    let records = statement
        .query_map(params![candidates_json, library_id, project_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, i64>(4)? != 0,
                row.get::<_, i64>(5)? != 0,
            ))
        })?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut projected = BTreeMap::new();
    for (target_source_id, page_id, lifecycle, title, active_membership, authorized) in records {
        let item = match (authorized, lifecycle, title) {
            (true, Some(lifecycle), Some(title)) => {
                let membership_state = match lifecycle.as_str() {
                    "deleted" => "deleted",
                    "archived" => "archived",
                    _ if active_membership => "active_in_target_source",
                    _ => "out_of_source",
                };
                DatabaseRelationTargetItem::Visible {
                    page_id: page_id.clone(),
                    title,
                    lifecycle,
                    membership_state: membership_state.to_owned(),
                }
            }
            _ => DatabaseRelationTargetItem::Restricted,
        };
        projected.insert((target_source_id, page_id), item);
    }
    Ok(projected)
}

fn validate_readable_targets(
    connection: &Connection,
    library_id: &str,
    project_id: Option<&str>,
    target_data_source_id: &str,
    page_ids: &BTreeSet<String>,
) -> Result<(), StoreError> {
    let Some(project_id) = project_id else {
        return Ok(());
    };
    if page_ids.is_empty() {
        return Ok(());
    }
    let targets = page_ids
        .iter()
        .map(|page_id| (target_data_source_id.to_owned(), page_id.clone()))
        .collect::<BTreeSet<_>>();
    let projected = project_targets(connection, library_id, Some(project_id), &targets)?;
    if targets.iter().all(|target| {
        matches!(
            projected.get(target),
            Some(DatabaseRelationTargetItem::Visible { .. })
        )
    }) {
        return Ok(());
    }
    Err(not_found("Relation target is unavailable"))
}

pub(crate) fn validate_active_targets(
    connection: &Connection,
    target_data_source_id: &str,
    page_ids: &[String],
) -> Result<(), StoreError> {
    if page_ids.is_empty() {
        return Ok(());
    }
    let page_ids_json = serde_json::to_string(page_ids)
        .map_err(|_| internal("Relation target identities cannot encode"))?;
    let valid: i64 = connection.query_row(
        "SELECT count(DISTINCT candidate.value) \
         FROM json_each(?1) candidate \
         JOIN blocks block ON block.id = candidate.value \
           AND block.type = 'page' AND block.lifecycle = 'active' \
         JOIN pages page ON page.block_id = block.id AND page.lifecycle = 'active' \
         JOIN data_source_page_memberships membership \
           ON membership.page_block_id = block.id \
           AND membership.data_source_id = ?2 AND membership.removed_at IS NULL \
         WHERE candidate.type = 'text'",
        params![page_ids_json, target_data_source_id],
        |row| row.get(0),
    )?;
    if usize::try_from(valid).ok() == Some(page_ids.len()) {
        return Ok(());
    }
    Err(not_found(
        "Relation target is not an active Page in the configured Data Source",
    ))
}

pub(crate) fn validate_view_filter_read_access(
    connection: &Connection,
    library_id: &str,
    project_id: Option<&str>,
    data_source_id: &str,
    config: &Value,
) -> Result<(), StoreError> {
    let Some(project_id) = project_id else {
        return Ok(());
    };
    let Some(filter) = config.get("filter") else {
        // Pre-v2 View fixtures and imported stores may not carry a canonical
        // filter node. There is no persisted operand to reauthorize in that
        // case, so preserve the historical unfiltered read behavior.
        return Ok(());
    };
    let mut targets = BTreeSet::new();
    collect_relation_filter_targets(connection, data_source_id, filter, 1, &mut 0, &mut targets)?;
    if targets.is_empty() {
        return Ok(());
    }
    let projected = project_targets(connection, library_id, Some(project_id), &targets)?;
    if targets.iter().all(|target| {
        matches!(
            projected.get(target),
            Some(DatabaseRelationTargetItem::Visible { .. })
        )
    }) {
        return Ok(());
    }
    Err(not_found("Database View is unavailable"))
}

fn collect_relation_filter_targets(
    connection: &Connection,
    data_source_id: &str,
    filter: &Value,
    depth: usize,
    nodes: &mut usize,
    targets: &mut BTreeSet<(String, String)>,
) -> Result<(), StoreError> {
    if depth > 8 || *nodes >= 1_024 {
        return Err(corrupt("Database View filter exceeds its structural bound"));
    }
    *nodes += 1;
    let object = filter
        .as_object()
        .ok_or_else(|| corrupt("Database View filter node is invalid"))?;
    if object.get("kind").and_then(Value::as_str) == Some("group") {
        let children = object
            .get("children")
            .and_then(Value::as_array)
            .ok_or_else(|| corrupt("Database View filter group is invalid"))?;
        for child in children {
            collect_relation_filter_targets(
                connection,
                data_source_id,
                child,
                depth + 1,
                nodes,
                targets,
            )?;
        }
        return Ok(());
    }
    if !matches!(
        object.get("operator").and_then(Value::as_str),
        Some("contains" | "not_contains")
    ) {
        return Ok(());
    }
    let Some(property_id) = object.get("propertyId").and_then(Value::as_str) else {
        return Err(corrupt("Database View filter Property is invalid"));
    };
    let target_data_source_id = connection
        .query_row(
            "SELECT relation.target_data_source_id \
             FROM data_source_relation_properties relation \
             JOIN data_source_properties property \
               ON property.data_source_id = relation.data_source_id \
               AND property.id = relation.property_id \
             WHERE relation.data_source_id = ?1 AND relation.property_id = ?2 \
               AND property.value_type = 'relation' AND property.lifecycle = 'active'",
            params![data_source_id, property_id],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    let Some(target_data_source_id) = target_data_source_id else {
        return Ok(());
    };
    let page_id = object
        .get("value")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| corrupt("Relation Property filter operand is invalid"))?;
    targets.insert((target_data_source_id, page_id.to_owned()));
    Ok(())
}

fn require_revision(expected: i64, actual: i64) -> Result<(), StoreError> {
    if expected == actual {
        return Ok(());
    }
    Err(StoreError::new(
        StoreErrorCode::RevisionConflict,
        format!("Relation value revision changed: expected {expected}, current {actual}"),
        true,
    ))
}

fn invalid(message: impl Into<String>) -> StoreError {
    StoreError::new(StoreErrorCode::InvalidInput, message, false)
}

fn not_found(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::NotFound, message, false)
}

fn resource_exhausted(message: impl Into<String>) -> StoreError {
    StoreError::new(StoreErrorCode::ResourceExhausted, message, false)
}

fn internal(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::Internal, message, false)
}

fn corrupt(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::StoreCorrupt, message, false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn view_relation_filter_is_reauthorized_after_target_access_revocation() {
        let connection = Connection::open_in_memory().expect("Relation authorization fixture");
        connection
            .execute_batch(
                "CREATE TABLE projects( \
                   id TEXT PRIMARY KEY, library_id TEXT NOT NULL, database_block_id TEXT); \
                 CREATE TABLE blocks(id TEXT PRIMARY KEY, project_id TEXT NOT NULL, type TEXT NOT NULL); \
                 CREATE TABLE pages( \
                   block_id TEXT PRIMARY KEY, library_id TEXT NOT NULL, document_id TEXT NOT NULL, \
                   parent_kind TEXT NOT NULL, parent_id TEXT NOT NULL, lifecycle TEXT NOT NULL); \
                 CREATE TABLE documents( \
                   id TEXT PRIMARY KEY, generation INTEGER NOT NULL, head_seq INTEGER NOT NULL, \
                   schema_version INTEGER NOT NULL); \
                 CREATE TABLE document_materializations( \
                   document_id TEXT NOT NULL, generation INTEGER NOT NULL, projected_seq INTEGER NOT NULL, \
                   schema_version INTEGER NOT NULL, title TEXT NOT NULL); \
                 CREATE TABLE data_sources( \
                   id TEXT PRIMARY KEY, library_id TEXT NOT NULL, home_database_block_id TEXT NOT NULL); \
                 CREATE TABLE data_source_page_memberships( \
                   data_source_id TEXT NOT NULL, page_block_id TEXT NOT NULL, removed_at TEXT); \
                 CREATE TABLE project_resource_grants( \
                   project_id TEXT NOT NULL, root_kind TEXT NOT NULL, root_id TEXT NOT NULL, \
                   lifecycle TEXT NOT NULL); \
                 CREATE TABLE data_source_properties( \
                   data_source_id TEXT NOT NULL, id TEXT NOT NULL, value_type TEXT NOT NULL, \
                   lifecycle TEXT NOT NULL); \
                 CREATE TABLE data_source_relation_properties( \
                   data_source_id TEXT NOT NULL, property_id TEXT NOT NULL, \
                   target_data_source_id TEXT NOT NULL); \
                 INSERT INTO projects VALUES ('project:reader', 'library:one', NULL); \
                 INSERT INTO blocks VALUES ('page:secret', 'project:owner', 'page'); \
                 INSERT INTO pages VALUES ( \
                   'page:secret', 'library:one', 'document:secret', \
                   'data_source', 'source:secret', 'active'); \
                 INSERT INTO documents VALUES ('document:secret', 1, 1, 1); \
                 INSERT INTO document_materializations VALUES ( \
                   'document:secret', 1, 1, 1, 'Secret target'); \
                 INSERT INTO data_sources VALUES ( \
                   'source:secret', 'library:one', 'database:secret'); \
                 INSERT INTO data_source_page_memberships VALUES ( \
                   'source:secret', 'page:secret', NULL); \
                 INSERT INTO data_source_properties VALUES ( \
                   'source:tasks', 'blocked_by', 'relation', 'active'); \
                 INSERT INTO data_source_relation_properties VALUES ( \
                   'source:tasks', 'blocked_by', 'source:secret'); \
                 INSERT INTO project_resource_grants VALUES ( \
                   'project:reader', 'database', 'database:secret', 'active');",
            )
            .expect("Relation authorization rows");
        let config = json!({
            "filter": {
                "kind": "clause",
                "propertyId": "blocked_by",
                "operator": "contains",
                "value": "page:secret"
            }
        });
        validate_view_filter_read_access(
            &connection,
            "library:one",
            Some("project:reader"),
            "source:tasks",
            &config,
        )
        .expect("authorized filter operand");

        connection
            .execute(
                "UPDATE project_resource_grants SET lifecycle = 'revoked'",
                [],
            )
            .expect("revoke target access");
        let error = validate_view_filter_read_access(
            &connection,
            "library:one",
            Some("project:reader"),
            "source:tasks",
            &config,
        )
        .expect_err("stale View filter cannot retain a restricted Page identity");
        assert_eq!(error.code, StoreErrorCode::NotFound);
    }
}
