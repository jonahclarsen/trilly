use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

#[derive(Deserialize, Serialize)]
pub struct Rule {
    id: String,
    merchant: String,
    payee_contains: Vec<String>,
    url: String,
    #[serde(default)]
    priority: i32,
    // Embedded favicon data URI; icon_source overrides where it was fetched from.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    icon: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    icon_source: Option<String>,
}

// Backend-owned registry: add merchants or alternative phrases in the JSON file.
// Exposed with state so local payee edits can update links without a round trip.
pub fn rules() -> &'static [Rule] {
    static RULES: OnceLock<Vec<Rule>> = OnceLock::new();
    RULES.get_or_init(|| {
        serde_json::from_str(include_str!("purchase_history.json"))
            .expect("valid bundled purchase history rules")
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_has_unique_ids_nonempty_phrases_and_https_destinations() {
        let mut ids = std::collections::HashSet::new();
        for rule in rules() {
            assert!(!rule.id.is_empty() && ids.insert(&rule.id));
            assert!(!rule.merchant.trim().is_empty());
            assert!(!rule.payee_contains.is_empty());
            assert!(
                rule.payee_contains
                    .iter()
                    .all(|phrase| !phrase.trim().is_empty())
            );
            if let Some(icon) = &rule.icon {
                assert!(icon.starts_with("data:image/"));
            }
            let url = reqwest::Url::parse(&rule.url.replace("%s", "query")).unwrap();
            assert_eq!(url.scheme(), "https");
            assert!(url.host_str().is_some());
        }
    }
}
