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

fn normalized(text: &str) -> String {
    text.to_lowercase()
        .split(|c: char| !c.is_alphabetic())
        .filter(|s| s.len() > 1)
        .collect::<Vec<_>>()
        .join(" ")
}
fn merchant(t: &Transaction) -> String {
    normalized(
        t.import_payee_name_original
            .as_deref()
            .or(t.import_payee_name.as_deref())
            .or(t.payee_name.as_deref())
            .unwrap_or(""),
    )
}

pub fn suggestions(data: &Data, target: &Transaction) -> Vec<Suggestion> {
    if target.special() {
        return vec![];
    }
    let name = merchant(target);
    let words: BTreeSet<_> = name.split_whitespace().collect();
    let mut scores: BTreeMap<(String, String), (f64, usize)> = BTreeMap::new();
    let target_date = chrono::NaiveDate::parse_from_str(&target.date, "%Y-%m-%d").ok();
    for t in &data.transactions {
        if !t.approved
            || t.deleted
            || t.id == target.id
            || t.special()
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
        let old_name = merchant(t);
        let old_words: BTreeSet<_> = old_name.split_whitespace().collect();
        let union = words.union(&old_words).count().max(1) as f64;
        let similarity = words.intersection(&old_words).count() as f64 / union;
        let same_payee = target.payee_id.as_ref() == Some(payee);
        if !same_payee && (name.is_empty() || similarity < 0.45) {
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
        let score = (if !name.is_empty() && name == old_name {
            5.
        } else {
            similarity * 3.
        }) + if same_payee { 2. } else { 0. }
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
        entry.0 += score * recency;
        entry.1 += 1;
    }
    let mut ranked: Vec<_> = scores.into_iter().collect();
    ranked.sort_by(|a, b| b.1.0.total_cmp(&a.1.0).then_with(|| a.0.cmp(&b.0)));
    ranked
        .into_iter()
        .take(3)
        .map(|((payee, category), (_, count))| Suggestion {
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
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
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
