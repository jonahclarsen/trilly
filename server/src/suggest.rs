use crate::model::*;
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Serialize)]
pub struct Suggestion {
    pub payee_id: Option<String>,
    pub category_id: Option<String>,
    pub payee: String,
    pub category: String,
    pub count: usize,
    pub reason: String,
}

// Deliberately bounded local stop list, not a geographic-name detector.
const IGNORED_WORDS: &[&str] = &[
    "vancouver",
    "bc",
    "british",
    "columbia",
    "canada",
    "ca",
    "cad",
    "burnaby",
    "richmond",
    "surrey",
    "coquitlam",
    "delta",
    "langley",
    "victoria",
    "toronto",
    "ontario",
    "on",
    "alberta",
    "ab",
    "calgary",
    "edmonton",
    "montreal",
    "quebec",
    "qc",
    "ottawa",
    "seattle",
    "wa",
    "sq",
    "pos",
    "purchase",
    "debit",
    "visa",
    "mastercard",
    "payment",
];

fn normalized(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|c: char| !c.is_alphabetic())
        .filter(|s| s.chars().count() > 1 && !IGNORED_WORDS.contains(s))
        .map(str::to_owned)
        .collect()
}

fn merchant_names(data: &Data, t: &Transaction) -> Vec<Vec<String>> {
    // Compare each name separately so unrelated fields cannot form a phrase.
    [
        t.import_payee_name_original.as_deref(),
        t.import_payee_name.as_deref(),
        t.payee_name.as_deref(),
        data.payees
            .iter()
            .find(|p| Some(&p.id) == t.payee_id.as_ref())
            .map(|p| p.name.as_str()),
    ]
    .into_iter()
    .flatten()
    .map(normalized)
    .filter(|words| !words.is_empty())
    .collect()
}

// Phrase matches beat unordered multiple words, then single-word fallbacks.
// Keep this separate from frequency so many weak matches cannot bury a phrase.
fn word_match(a: &[String], b: &[String]) -> (usize, usize, usize) {
    let a_set: BTreeSet<_> = a.iter().collect();
    let b_set: BTreeSet<_> = b.iter().collect();
    let shared = a_set.intersection(&b_set).count();
    let mut longest = 0;
    for i in 0..a.len() {
        for j in 0..b.len() {
            let length = a[i..]
                .iter()
                .zip(&b[j..])
                .take_while(|(x, y)| x == y)
                .count();
            // Repeated copies of one word are not a multi-word phrase.
            if length >= 2 && a[i..i + length].iter().collect::<BTreeSet<_>>().len() >= 2 {
                longest = longest.max(length);
            }
        }
    }
    (
        if longest >= 2 {
            3
        } else if shared >= 2 {
            2
        } else if shared == 1 {
            1
        } else {
            0
        },
        longest,
        shared,
    )
}

#[derive(Default)]
struct Score {
    words: (usize, usize, usize),
    context: f64,
    count: usize,
}

pub fn suggestions(data: &Data, target: &Transaction) -> Vec<Suggestion> {
    if target.special() {
        return vec![];
    }
    let names = merchant_names(data, target);
    let mut scores: BTreeMap<(String, String), Score> = BTreeMap::new();
    let target_date = chrono::NaiveDate::parse_from_str(&target.date, "%Y-%m-%d").ok();
    for t in &data.transactions {
        if !t.approved
            || t.deleted
            || t.id == target.id
            // Reconciled history is useful evidence even though it cannot be edited.
            || !t.subtransactions.is_empty()
            || t.transfer_account_id.is_some()
            || t.debt_transaction_type.is_some()
            || t.amount.signum() != target.amount.signum()
        {
            continue;
        }
        let (Some(payee), Some(category)) = (&t.payee_id, &t.category_id) else {
            continue;
        };
        if !data
            .categories
            .iter()
            .any(|c| c.id == *category && !c.hidden && !c.deleted)
            || !data
                .payees
                .iter()
                .any(|p| p.id == *payee && !p.deleted && p.transfer_account_id.is_none())
        {
            continue;
        }
        let old_names = merchant_names(data, t);
        let words = names
            .iter()
            .flat_map(|name| old_names.iter().map(move |old| word_match(name, old)))
            .max()
            .unwrap_or_default();
        let same_payee = target.payee_id.as_ref() == Some(payee);
        if !same_payee && words.0 == 0 {
            continue;
        }
        let days = target_date
            .zip(chrono::NaiveDate::parse_from_str(&t.date, "%Y-%m-%d").ok())
            .map(|(a, b)| (a - b).num_days().unsigned_abs() as f64)
            .unwrap_or(365.);
        let recency = 0.25 + 0.75 * (-days / 180.).exp();
        let amount = 1.
            - ((target.amount as f64 - t.amount as f64).abs()
                / (target
                    .amount
                    .unsigned_abs()
                    .max(t.amount.unsigned_abs())
                    .max(1) as f64))
                .min(1.);
        let score = (if same_payee { 2. } else { 0. })
            + if t.account_id == target.account_id {
                1.
            } else {
                0.
            }
            + amount * 2.
            + if target.memo.is_some() && target.memo == t.memo {
                1.
            } else {
                0.
            };
        let entry = scores.entry((payee.clone(), category.clone())).or_default();
        entry.words = entry.words.max(words);
        entry.context += score * recency;
        entry.count += 1;
    }
    let mut ranked: Vec<_> = scores.into_iter().collect();
    ranked.sort_by(|a, b| {
        b.1.words
            .cmp(&a.1.words)
            .then_with(|| b.1.context.total_cmp(&a.1.context))
            .then_with(|| a.0.cmp(&b.0))
    });
    ranked
        .into_iter()
        .take(3)
        .map(|((payee, category), score)| {
            let count = score.count;
            Suggestion {
                payee: data
                    .payees
                    .iter()
                    .find(|p| p.id == payee)
                    .map(|p| p.name.clone())
                    .unwrap_or_default(),
                category: data
                    .categories
                    .iter()
                    .find(|c| c.id == category)
                    .map(|c| c.name.clone())
                    .unwrap_or_default(),
                payee_id: Some(payee),
                category_id: Some(category),
                count,
                reason: format!(
                    "{count} similar {}",
                    if count == 1 {
                        "transaction"
                    } else {
                        "transactions"
                    }
                ),
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture(names: &[&str]) -> (Data, Transaction) {
        let mut data = Data::default();
        data.categories.push(Category {
            id: "food".into(),
            name: "Food".into(),
            ..Default::default()
        });
        for (i, name) in names.iter().enumerate() {
            let id = format!("payee-{i}");
            data.payees.push(Payee {
                id: id.clone(),
                name: (*name).into(),
                ..Default::default()
            });
            data.transactions.push(Transaction {
                id: format!("history-{i}"),
                approved: true,
                amount: -42000,
                payee_id: Some(id),
                category_id: Some("food".into()),
                import_payee_name_original: Some((*name).into()),
                date: "2026-09-08".into(),
                ..Default::default()
            });
        }
        let target = Transaction {
            id: "target".into(),
            amount: -42000,
            date: "2026-09-09".into(),
            import_payee_name_original: Some("SQ *cedar coffee house VANCOUVER BC".into()),
            ..Default::default()
        };
        (data, target)
    }

    #[test]
    fn phrases_beat_multiple_words_then_single_words_even_with_frequent_weak_history() {
        let (mut data, target) = fixture(&[
            "Cedar supplies",
            "House Cedar Coffee",
            "Cedar House",
            "CEDAR COFFEE HOUSE",
        ]);
        // A common one-word match must not outweigh a precise phrase.
        for i in 0..100 {
            let mut weak = data.transactions[0].clone();
            weak.id = format!("weak-{i}");
            data.transactions.push(weak);
        }
        let picks = suggestions(&data, &target);
        assert_eq!(
            picks.iter().map(|p| p.payee.as_str()).collect::<Vec<_>>(),
            vec!["CEDAR COFFEE HOUSE", "House Cedar Coffee", "Cedar House"]
        );
        data.transactions
            .retain(|t| t.payee_id.as_deref() == Some("payee-0"));
        assert_eq!(suggestions(&data, &target)[0].payee, "Cedar supplies");
    }

    #[test]
    fn ignores_locations_and_payment_noise_without_substring_matches() {
        let (data, mut target) = fixture(&[
            "Unrelated Vancouver BC",
            "Cedarwood supplies",
            "SQ POS VISA",
        ]);
        assert!(suggestions(&data, &target).is_empty());
        target.import_payee_name_original = Some("VANCOUVER British Columbia Canada".into());
        assert!(suggestions(&data, &target).is_empty());
        assert_eq!(
            normalized("CeDaR COFFEE #123 Vancouver BC"),
            vec!["cedar", "coffee"]
        );
        assert_eq!(
            word_match(&normalized("coffee coffee"), &normalized("coffee coffee")),
            (1, 0, 1)
        );
    }

    #[test]
    fn matches_saved_payee_names_even_when_imported_descriptions_differ() {
        let (mut data, target) = fixture(&["Cedar Coffee House"]);
        data.transactions[0].import_payee_name_original = Some("PROCESSOR XYZ".into());
        assert_eq!(suggestions(&data, &target)[0].payee, "Cedar Coffee House");
        data.categories[0].hidden = true;
        assert!(suggestions(&data, &target).is_empty());
        data.categories[0].hidden = false;
        data.payees[0].deleted = true;
        assert!(suggestions(&data, &target).is_empty());
        data.payees[0].deleted = false;
        data.transactions[0].amount = 42000;
        assert!(suggestions(&data, &target).is_empty());
    }

    #[test]
    fn reconciled_history_informs_suggestions_but_special_targets_remain_protected() {
        let (mut data, mut target) = fixture(&["Cedar Coffee House"]);
        data.transactions[0].cleared = "reconciled".into();
        assert_eq!(suggestions(&data, &target)[0].payee, "Cedar Coffee House");
        target.cleared = "reconciled".into();
        assert!(suggestions(&data, &target).is_empty());
        target.cleared = "cleared".into();
        data.transactions[0].transfer_account_id = Some("other".into());
        assert!(suggestions(&data, &target).is_empty());
        data.transactions[0].transfer_account_id = None;
        data.transactions[0].debt_transaction_type = Some("payment".into());
        assert!(suggestions(&data, &target).is_empty());
        data.transactions[0].debt_transaction_type = None;
        data.transactions[0].subtransactions.push(Split::default());
        assert!(suggestions(&data, &target).is_empty());
    }

    #[test]
    fn learns_merchant_variants_ignores_unapproved_deleted_and_transfers() {
        let mut d = Data::default();
        d.categories.push(Category {
            id: "food".into(),
            name: "Groceries".into(),
            ..Default::default()
        });
        d.payees.push(Payee {
            id: "p".into(),
            name: "Market".into(),
            ..Default::default()
        });
        let mut t = Transaction {
            id: "history".into(),
            approved: true,
            amount: -42000,
            payee_id: Some("p".into()),
            category_id: Some("food".into()),
            import_payee_name_original: Some("MARKET #00921".into()),
            ..Default::default()
        };
        d.transactions.push(t.clone());
        t.id = "new".into();
        t.approved = false;
        t.payee_id = None;
        t.import_payee_name_original = Some("MARKET #04212".into());
        assert_eq!(suggestions(&d, &t)[0].category, "Groceries");
        d.transactions[0].approved = false;
        assert!(suggestions(&d, &t).is_empty());
        d.transactions[0].approved = true;
        d.transactions[0].deleted = true;
        assert!(suggestions(&d, &t).is_empty());
        d.transactions[0].deleted = false;
        t.transfer_account_id = Some("transfer".into());
        assert!(suggestions(&d, &t).is_empty());
    }
}
