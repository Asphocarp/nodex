use std::collections::{BTreeMap, BTreeSet};

use nodex_core_contracts::{CoreModuleEventPayload, PageDocumentHeadImpact, ProjectionImpact};
use rusqlite::Connection;
use rusqlite::{OptionalExtension, params};

use super::sqlite::{StoreError, StoreErrorCode};

const MAX_PROJECTION_IDENTITIES: usize = 10_000;
const MAX_PROJECTION_IMPACT_BYTES: usize = 1024 * 1024;
const MAX_IDENTITY_BYTES: usize = 512;

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct PageProjectionDatabaseCoordinates {
    pub database_id: String,
    pub data_source_id: String,
    pub view_ids: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct PageProjectionCoordinates {
    pub page_id: String,
    pub database: Option<PageProjectionDatabaseCoordinates>,
}

pub fn impact_for_payload(
    payload: &CoreModuleEventPayload,
) -> Result<ProjectionImpact, StoreError> {
    let impact = match payload {
        CoreModuleEventPayload::Library(event) => ProjectionImpact::Resources {
            page_ids: event.page_ids.clone(),
            database_ids: event.database_ids.clone(),
            data_source_ids: Vec::new(),
            view_ids: event.view_ids.clone(),
            document_heads: Vec::new(),
        },
        CoreModuleEventPayload::Database(event) => ProjectionImpact::Resources {
            page_ids: event.page_ids.clone(),
            database_ids: event.database_ids.clone(),
            data_source_ids: event.data_source_ids.clone(),
            view_ids: event.view_ids.clone(),
            document_heads: Vec::new(),
        },
        CoreModuleEventPayload::Automation(event) => ProjectionImpact::Resources {
            page_ids: event.page_ids.clone(),
            database_ids: event.database_ids.clone(),
            data_source_ids: Vec::new(),
            view_ids: Vec::new(),
            document_heads: Vec::new(),
        },
        CoreModuleEventPayload::OwnedDocument(_) => ProjectionImpact::None,
        CoreModuleEventPayload::ProjectWorkspace(_)
        | CoreModuleEventPayload::StoreAdministration(_) => ProjectionImpact::None,
    };
    canonicalize(impact)
}

pub(crate) fn impact_for_page_document(
    page_impact: Option<&PageProjectionCoordinates>,
    document_head: Option<(&str, i64, i64)>,
) -> Result<ProjectionImpact, StoreError> {
    let Some(page_impact) = page_impact else {
        return Ok(ProjectionImpact::None);
    };
    let document_heads = document_head
        .map(
            |(document_id, generation, head_seq)| PageDocumentHeadImpact {
                page_id: page_impact.page_id.clone(),
                document_id: document_id.to_owned(),
                generation,
                head_seq,
            },
        )
        .into_iter()
        .collect();
    canonicalize(ProjectionImpact::Resources {
        page_ids: vec![page_impact.page_id.clone()],
        database_ids: page_impact
            .database
            .iter()
            .map(|database| database.database_id.clone())
            .collect(),
        data_source_ids: page_impact
            .database
            .iter()
            .map(|database| database.data_source_id.clone())
            .collect(),
        view_ids: page_impact
            .database
            .iter()
            .flat_map(|database| database.view_ids.clone())
            .collect(),
        document_heads,
    })
}

pub fn expand_database_coordinates(
    connection: &Connection,
    impact: ProjectionImpact,
) -> Result<ProjectionImpact, StoreError> {
    let impact = canonicalize(impact)?;
    let ProjectionImpact::Resources {
        page_ids,
        database_ids,
        data_source_ids,
        view_ids,
        document_heads,
    } = impact
    else {
        return Ok(impact);
    };
    let original_page_ids = page_ids.clone();
    let mut pages = page_ids.into_iter().collect::<BTreeSet<_>>();
    let mut databases = database_ids.into_iter().collect::<BTreeSet<_>>();
    let mut data_sources = data_source_ids.into_iter().collect::<BTreeSet<_>>();
    let mut views = view_ids.into_iter().collect::<BTreeSet<_>>();

    for target_page_id in &original_page_ids {
        let inbound = connection
            .prepare(
                "SELECT DISTINCT membership.page_block_id, edge.source_data_source_id \
                 FROM data_source_relation_edges edge \
                 JOIN data_source_page_memberships membership \
                   ON membership.data_source_id = edge.source_data_source_id \
                   AND membership.id = edge.source_membership_id \
                 WHERE edge.target_page_block_id = ?1",
            )?
            .query_map([target_page_id], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        for (source_page_id, source_data_source_id) in inbound {
            pages.insert(source_page_id);
            data_sources.insert(source_data_source_id);
        }
    }

    for page_id in &pages {
        let data_source_id = connection
            .query_row(
                "WITH RECURSIVE ancestors(page_id, parent_kind, parent_id, path) AS ( \
                   SELECT block_id, parent_kind, parent_id, '|' || block_id || '|' FROM pages \
                     WHERE block_id = ?1 \
                   UNION ALL \
                   SELECT page.block_id, page.parent_kind, page.parent_id, \
                     ancestors.path || page.block_id || '|' \
                   FROM pages page JOIN ancestors ON ancestors.parent_kind = 'page' \
                     AND page.block_id = ancestors.parent_id \
                   WHERE instr(ancestors.path, '|' || page.block_id || '|') = 0) \
                 SELECT parent_id FROM ancestors WHERE parent_kind = 'data_source' LIMIT 1",
                [page_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        data_sources.extend(data_source_id);
    }

    for view_id in views.clone() {
        let coordinates = connection
            .query_row(
                "SELECT database_block_id, data_source_id FROM database_views WHERE id = ?1",
                [view_id],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?;
        if let Some((database_id, data_source_id)) = coordinates {
            databases.insert(database_id);
            data_sources.insert(data_source_id);
        }
    }

    for data_source_id in data_sources.clone() {
        let database_id = connection
            .query_row(
                "SELECT home_database_block_id FROM data_sources WHERE id = ?1",
                [&data_source_id],
                |row| row.get::<_, String>(0),
            )
            .optional()?;
        databases.extend(database_id);
        let mut statement = connection
            .prepare("SELECT id FROM database_views WHERE data_source_id = ?1 ORDER BY id")?;
        let rows = statement.query_map([&data_source_id], |row| row.get::<_, String>(0))?;
        for row in rows {
            views.insert(row?);
        }
    }

    for database_id in databases.clone() {
        let mut source_statement = connection
            .prepare("SELECT id FROM data_sources WHERE home_database_block_id = ?1 ORDER BY id")?;
        let source_rows =
            source_statement.query_map([&database_id], |row| row.get::<_, String>(0))?;
        for row in source_rows {
            data_sources.insert(row?);
        }
        let mut view_statement = connection
            .prepare("SELECT id FROM database_views WHERE database_block_id = ?1 ORDER BY id")?;
        let view_rows =
            view_statement.query_map(params![database_id], |row| row.get::<_, String>(0))?;
        for row in view_rows {
            views.insert(row?);
        }
    }

    canonicalize(ProjectionImpact::Resources {
        page_ids: pages.into_iter().collect(),
        database_ids: databases.into_iter().collect(),
        data_source_ids: data_sources.into_iter().collect(),
        view_ids: views.into_iter().collect(),
        document_heads,
    })
}

pub fn canonicalize(impact: ProjectionImpact) -> Result<ProjectionImpact, StoreError> {
    let ProjectionImpact::Resources {
        page_ids,
        database_ids,
        data_source_ids,
        view_ids,
        document_heads,
    } = impact
    else {
        return Ok(impact);
    };

    let Some(page_ids) = canonical_identities(page_ids, "Projection Page")? else {
        return Ok(ProjectionImpact::All);
    };
    let Some(database_ids) = canonical_identities(database_ids, "Projection Database")? else {
        return Ok(ProjectionImpact::All);
    };
    let Some(data_source_ids) = canonical_identities(data_source_ids, "Projection Data Source")?
    else {
        return Ok(ProjectionImpact::All);
    };
    let Some(view_ids) = canonical_identities(view_ids, "Projection View")? else {
        return Ok(ProjectionImpact::All);
    };
    let total = page_ids.len() + database_ids.len() + data_source_ids.len() + view_ids.len();
    if total > MAX_PROJECTION_IDENTITIES || document_heads.len() > MAX_PROJECTION_IDENTITIES {
        return Ok(ProjectionImpact::All);
    }

    let page_set = page_ids.iter().collect::<BTreeSet<_>>();
    let mut heads = BTreeMap::new();
    for head in document_heads {
        validate_identity(&head.page_id, "Projection head Page")?;
        validate_identity(&head.document_id, "Projection head Document")?;
        if !page_set.contains(&head.page_id) || head.generation < 1 || head.head_seq < 1 {
            return Err(corrupt("Projection Document head is inconsistent"));
        }
        let key = (head.page_id.clone(), head.document_id.clone());
        if heads.insert(key, head).is_some() {
            return Err(corrupt("Projection Document head identity is duplicated"));
        }
    }
    if page_ids.is_empty()
        && database_ids.is_empty()
        && data_source_ids.is_empty()
        && view_ids.is_empty()
        && heads.is_empty()
    {
        return Ok(ProjectionImpact::None);
    }
    Ok(ProjectionImpact::Resources {
        page_ids,
        database_ids,
        data_source_ids,
        view_ids,
        document_heads: heads.into_values().collect(),
    })
}

pub fn encode(impact: &ProjectionImpact) -> Result<String, StoreError> {
    let encoded = serde_json::to_string(impact)
        .map_err(|_| internal("Projection impact could not be encoded"))?;
    if encoded.len() > MAX_PROJECTION_IMPACT_BYTES {
        return serde_json::to_string(&ProjectionImpact::All)
            .map_err(|_| internal("Broad projection impact could not be encoded"));
    }
    Ok(encoded)
}

pub fn decode(encoded: &str) -> Result<ProjectionImpact, StoreError> {
    if encoded.len() > MAX_PROJECTION_IMPACT_BYTES {
        return Err(corrupt("Projection impact exceeds its byte bound"));
    }
    let decoded = serde_json::from_str::<ProjectionImpact>(encoded)
        .map_err(|_| corrupt("Projection impact is invalid"))?;
    let canonical = canonicalize(decoded.clone())?;
    if canonical != decoded {
        return Err(corrupt("Projection impact is not canonical"));
    }
    Ok(decoded)
}

pub fn replay_floor(connection: &Connection) -> Result<i64, StoreError> {
    let floor = connection.query_row(
        "SELECT projection_event_v2_floor FROM core_store_metadata WHERE id = 1",
        [],
        |row| row.get::<_, Option<i64>>(0),
    )?;
    floor
        .filter(|floor| *floor >= 1)
        .ok_or_else(|| corrupt("Projection event replay floor is unavailable"))
}

fn canonical_identities(
    identities: Vec<String>,
    label: &str,
) -> Result<Option<Vec<String>>, StoreError> {
    let mut canonical = BTreeSet::new();
    for identity in identities {
        validate_identity(&identity, label)?;
        canonical.insert(identity);
        if canonical.len() > MAX_PROJECTION_IDENTITIES {
            return Ok(None);
        }
    }
    Ok(Some(canonical.into_iter().collect()))
}

fn validate_identity(identity: &str, label: &str) -> Result<(), StoreError> {
    if identity.is_empty() || identity.len() > MAX_IDENTITY_BYTES || identity != identity.trim() {
        return Err(corrupt(format!("{label} identity is invalid")));
    }
    Ok(())
}

fn corrupt(message: impl Into<String>) -> StoreError {
    StoreError::new(StoreErrorCode::StoreCorrupt, message, false)
}

fn internal(message: &str) -> StoreError {
    StoreError::new(StoreErrorCode::Internal, message, false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonicalizes_resource_coordinates_and_document_heads() {
        let impact = canonicalize(ProjectionImpact::Resources {
            page_ids: vec![
                "page-b".to_owned(),
                "page-a".to_owned(),
                "page-a".to_owned(),
            ],
            database_ids: vec!["database-b".to_owned(), "database-a".to_owned()],
            data_source_ids: vec!["source-a".to_owned()],
            view_ids: vec!["view-a".to_owned()],
            document_heads: vec![PageDocumentHeadImpact {
                page_id: "page-a".to_owned(),
                document_id: "document-a".to_owned(),
                generation: 1,
                head_seq: 2,
            }],
        })
        .expect("canonical impact");
        assert_eq!(
            impact,
            ProjectionImpact::Resources {
                page_ids: vec!["page-a".to_owned(), "page-b".to_owned()],
                database_ids: vec!["database-a".to_owned(), "database-b".to_owned()],
                data_source_ids: vec!["source-a".to_owned()],
                view_ids: vec!["view-a".to_owned()],
                document_heads: vec![PageDocumentHeadImpact {
                    page_id: "page-a".to_owned(),
                    document_id: "document-a".to_owned(),
                    generation: 1,
                    head_seq: 2,
                }],
            }
        );
    }

    #[test]
    fn rejects_a_document_head_without_its_page() {
        let error = canonicalize(ProjectionImpact::Resources {
            page_ids: Vec::new(),
            database_ids: Vec::new(),
            data_source_ids: Vec::new(),
            view_ids: Vec::new(),
            document_heads: vec![PageDocumentHeadImpact {
                page_id: "page-a".to_owned(),
                document_id: "document-a".to_owned(),
                generation: 1,
                head_seq: 1,
            }],
        })
        .expect_err("orphan head must fail");
        assert_eq!(error.code, StoreErrorCode::StoreCorrupt);
    }

    #[test]
    fn normalizes_empty_resources_and_broadens_unbounded_identity_sets() {
        assert_eq!(
            canonicalize(ProjectionImpact::Resources {
                page_ids: Vec::new(),
                database_ids: Vec::new(),
                data_source_ids: Vec::new(),
                view_ids: Vec::new(),
                document_heads: Vec::new(),
            })
            .expect("empty impact"),
            ProjectionImpact::None
        );
        assert_eq!(
            canonicalize(ProjectionImpact::Resources {
                page_ids: (0..=MAX_PROJECTION_IDENTITIES)
                    .map(|index| format!("page-{index:05}"))
                    .collect(),
                database_ids: Vec::new(),
                data_source_ids: Vec::new(),
                view_ids: Vec::new(),
                document_heads: Vec::new(),
            })
            .expect("bounded broad impact"),
            ProjectionImpact::All
        );
    }

    #[test]
    fn rejects_duplicate_final_heads_for_one_page_document() {
        let head = PageDocumentHeadImpact {
            page_id: "page-a".to_owned(),
            document_id: "document-a".to_owned(),
            generation: 1,
            head_seq: 2,
        };
        let error = canonicalize(ProjectionImpact::Resources {
            page_ids: vec!["page-a".to_owned()],
            database_ids: Vec::new(),
            data_source_ids: Vec::new(),
            view_ids: Vec::new(),
            document_heads: vec![head.clone(), head],
        })
        .expect_err("duplicate final head must fail");
        assert_eq!(error.code, StoreErrorCode::StoreCorrupt);
    }
}
