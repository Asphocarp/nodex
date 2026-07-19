use sha2::{Digest, Sha256};

pub(crate) fn stable_uuid_v7(namespace: &str, role: &str, source_id: &str) -> String {
    let digest = Sha256::digest(format!("{namespace}\0{role}\0{source_id}").as_bytes());
    let hex = digest
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    format!(
        "{}-{}-7{}-8{}-{}",
        &hex[..8],
        &hex[8..12],
        &hex[12..15],
        &hex[15..18],
        &hex[18..30],
    )
}

#[cfg(test)]
mod tests {
    use super::stable_uuid_v7;

    #[test]
    fn derives_stable_role_separated_uuid_v7_identities() {
        let first = stable_uuid_v7("operation-1", "database", "project-1");
        assert_eq!(
            first,
            stable_uuid_v7("operation-1", "database", "project-1")
        );
        assert_ne!(first, stable_uuid_v7("operation-1", "view", "project-1"));
        assert_eq!(first.len(), 36);
        assert_eq!(&first[14..15], "7");
        assert_eq!(&first[19..20], "8");
    }
}
