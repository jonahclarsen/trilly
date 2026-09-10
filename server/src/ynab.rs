use crate::model::*;
use reqwest::{Client, Method};
use serde_json::{Value, json};
use std::time::Duration;

pub struct Ynab {
    client: Client,
    base: String,
}
impl Ynab {
    pub fn new() -> Self {
        Self {
            client: Client::builder()
                .timeout(Duration::from_secs(25))
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .unwrap(),
            base: "https://api.ynab.com/v1".into(),
        }
    }
    async fn request(
        &self,
        token: &str,
        method: Method,
        path: &str,
        body: Option<Value>,
    ) -> Result<Value, String> {
        let mut req = self
            .client
            .request(method, format!("{}{path}", self.base))
            .bearer_auth(token);
        if let Some(body) = body {
            req = req.json(&body);
        }
        let response = req
            .send()
            .await
            .map_err(|_| "Could not reach YNAB. Changes remain saved locally.")?;
        match response.status().as_u16() {
            200..=299 => {}
            401 | 403 => return Err("YNAB access denied. Update your token in Settings.".into()),
            429 => {
                return Err(
                    "YNAB's hourly limit was reached. Changes are saved; try syncing later.".into(),
                );
            }
            400 | 409 => {
                return Err(
                    "YNAB rejected an update. Undo it and review the transaction in YNAB.".into(),
                );
            }
            _ => return Err("YNAB is unavailable. Changes remain saved locally.".into()),
        }
        let value: Value = response
            .json()
            .await
            .map_err(|_| "Invalid response from YNAB")?;
        value
            .get("data")
            .cloned()
            .ok_or_else(|| "Invalid response from YNAB".into())
    }
    pub async fn plans(&self, token: &str) -> Result<Vec<Plan>, String> {
        let value = self.request(token, Method::GET, "/plans", None).await?;
        parse(&value["plans"])
    }
    pub async fn refresh(&self, data: &mut Data, metadata: bool) -> Result<(), String> {
        if data.plan_id.is_empty() {
            return Ok(());
        }
        let path = format!("/plans/{}", data.plan_id);
        if metadata {
            let accounts = self
                .request(&data.token, Method::GET, &format!("{path}/accounts"), None)
                .await?;
            data.accounts = parse(&accounts["accounts"])?;
            let categories = self
                .request(
                    &data.token,
                    Method::GET,
                    &format!("{path}/categories"),
                    None,
                )
                .await?;
            let mut all = Vec::new();
            for group in categories["category_groups"]
                .as_array()
                .ok_or("Invalid categories")?
            {
                let group_name = group["name"].as_str().unwrap_or("");
                for mut category in parse::<Vec<Category>>(&group["categories"])? {
                    category.category_group_name = group_name.to_string();
                    category.hidden |= group["hidden"].as_bool().unwrap_or(false);
                    category.deleted |= group["deleted"].as_bool().unwrap_or(false);
                    // YNAB doesn't permit assigning Credit Card Payment categories.
                    category.hidden |= group_name == "Credit Card Payments"
                        || group_name == "Internal Master Category";
                    all.push(category);
                }
            }
            data.categories = all;
            let payees = self
                .request(&data.token, Method::GET, &format!("{path}/payees"), None)
                .await?;
            data.payees = parse(&payees["payees"])?;
        }
        let query = if data.knowledge > 0 {
            format!(
                "?since_date=2000-01-01&last_knowledge_of_server={}",
                data.knowledge
            )
        } else {
            "?since_date=2000-01-01".to_string()
        };
        let response = self
            .request(
                &data.token,
                Method::GET,
                &format!("{path}/transactions{query}"),
                None,
            )
            .await?;
        let transactions: Vec<Transaction> = parse(&response["transactions"])?;
        // Merge tombstones too, so deletions cannot reappear in the review queue.
        let mut merged: std::collections::BTreeMap<String, Transaction> =
            std::mem::take(&mut data.transactions)
                .into_iter()
                .map(|t| (t.id.clone(), t))
                .collect();
        for transaction in transactions {
            merged.insert(transaction.id.clone(), transaction);
        }
        data.transactions = merged.into_values().collect();
        data.knowledge = response["server_knowledge"]
            .as_i64()
            .ok_or("Missing sync cursor")?;
        data.synced_at = Some(chrono::Utc::now().to_rfc3339());
        Ok(())
    }

    // The caller saves pending work before this runs. An ambiguous network failure
    // leaves the outbox intact; the next refresh recognizes already-applied writes.
    pub async fn flush(&self, data: &mut Data) -> Result<(), String> {
        let mut updates = Vec::new();
        let mut completed = Vec::new();
        for pending in &mut data.pending {
            let current = data.transactions.iter().find(|t| t.id == pending.change.id);
            if current.is_some_and(|t| {
                !t.deleted
                    && t.matches_change(&pending.change)
                    && t.account_id == pending.before.account_id
                    && t.amount == pending.before.amount
            }) {
                completed.push(pending.change.id.clone());
                continue;
            }
            if !current.is_some_and(|t| t.same_editable_state(&pending.before)) {
                pending.conflict = true;
                continue;
            }
            pending.conflict = false;
            // Never submit category/payee fields on a split, transfer, or loan.
            updates.push(if pending.before.special() {
                json!({"id": pending.change.id, "approved": pending.change.approved})
            } else {
                serde_json::to_value(&pending.change).map_err(|_| "Could not encode update")?
            });
        }
        data.pending.retain(|p| !completed.contains(&p.change.id));
        if !updates.is_empty() {
            let response = self
                .request(
                    &data.token,
                    Method::PATCH,
                    &format!("/plans/{}/transactions", data.plan_id),
                    Some(json!({"transactions": updates})),
                )
                .await?;
            let updated: Vec<Transaction> = parse(&response["transactions"])?;
            for t in updated {
                let applied = data
                    .pending
                    .iter()
                    .any(|p| p.change.id == t.id && t.matches_change(&p.change));
                if applied {
                    data.pending.retain(|p| p.change.id != t.id);
                }
                if let Some(old) = data.transactions.iter_mut().find(|old| old.id == t.id) {
                    *old = t;
                }
            }
        }
        if data.pending.iter().any(|p| p.conflict) {
            return Err(
                "A transaction changed in YNAB. Undo the pending change, then review it again."
                    .into(),
            );
        }
        if !data.pending.is_empty() {
            return Err("Some changes are still pending. Sync again to verify.".into());
        }
        Ok(())
    }
}

fn parse<T: serde::de::DeserializeOwned>(value: &Value) -> Result<T, String> {
    serde_json::from_value(value.clone()).map_err(|_| "Unexpected YNAB response".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        Json, Router,
        extract::{Query, State},
        http::StatusCode,
        routing::get,
    };
    use std::{collections::HashMap, sync::Arc};
    use tokio::sync::Mutex;

    #[derive(Default)]
    struct Mock {
        transactions: Vec<Transaction>,
        writes: Vec<Value>,
        fail_after_write: bool,
        queries: Vec<HashMap<String, String>>,
    }
    async fn read(
        State(s): State<Arc<Mutex<Mock>>>,
        Query(query): Query<HashMap<String, String>>,
    ) -> Json<Value> {
        let mut mock = s.lock().await;
        mock.queries.push(query);
        Json(json!({"data": {"transactions": mock.transactions, "server_knowledge": 2}}))
    }
    async fn write(
        State(s): State<Arc<Mutex<Mock>>>,
        Json(body): Json<Value>,
    ) -> (StatusCode, Json<Value>) {
        let mut mock = s.lock().await;
        mock.writes.push(body.clone());
        let mut result = Vec::new();
        for update in body["transactions"].as_array().unwrap() {
            let t = mock
                .transactions
                .iter_mut()
                .find(|t| t.id == update["id"].as_str().unwrap())
                .unwrap();
            t.approved = update["approved"].as_bool().unwrap();
            if update.get("payee_id").is_some() {
                t.payee_id = serde_json::from_value(update["payee_id"].clone()).unwrap();
            }
            if update.get("category_id").is_some() {
                t.category_id = serde_json::from_value(update["category_id"].clone()).unwrap();
            }
            result.push(t.clone());
        }
        if mock.fail_after_write {
            (StatusCode::SERVICE_UNAVAILABLE, Json(json!({})))
        } else {
            (
                StatusCode::OK,
                Json(json!({"data": {"transactions": result}})),
            )
        }
    }
    async fn setup() -> (Ynab, Arc<Mutex<Mock>>, Data, tokio::task::JoinHandle<()>) {
        let before = Transaction {
            id: "synthetic-transaction".into(),
            account_id: "synthetic-account".into(),
            amount: -42000,
            payee_id: Some("synthetic-payee".into()),
            category_id: Some("original-category".into()),
            ..Default::default()
        };
        let mock = Arc::new(Mutex::new(Mock {
            transactions: vec![before.clone()],
            ..Default::default()
        }));
        let app = Router::new()
            .route("/plans/test/transactions", get(read).patch(write))
            .with_state(mock.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", listener.local_addr().unwrap());
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let mut data = Data::default();
        data.plan_id = "test".into();
        data.token = "synthetic-only".into();
        data.transactions.push(before.clone());
        let mut change = Change::from(&before);
        change.approved = true;
        change.category_id = Some("new-category".into());
        data.pending.push(Pending {
            before,
            change,
            conflict: false,
        });
        (
            Ynab {
                client: Client::new(),
                base,
            },
            mock,
            data,
            server,
        )
    }

    #[tokio::test]
    async fn updates_approved_payee_category_and_uses_delta_cursor() {
        let (api, mock, mut data, server) = setup().await;
        data.knowledge = 1;
        api.refresh(&mut data, false).await.unwrap();
        api.flush(&mut data).await.unwrap();
        assert!(data.pending.is_empty());
        assert!(data.transactions[0].approved);
        assert_eq!(
            data.transactions[0].category_id.as_deref(),
            Some("new-category")
        );
        let m = mock.lock().await;
        assert_eq!(m.queries[0]["last_knowledge_of_server"], "1");
        assert_eq!(m.queries[0]["since_date"], "2000-01-01");
        assert!(m.writes[0]["transactions"][0].get("amount").is_none());
        server.abort();
    }

    #[tokio::test]
    async fn recovers_a_lost_write_response_after_encrypted_restart_without_duplicate_patch() {
        let (api, mock, mut data, server) = setup().await;
        mock.lock().await.fail_after_write = true;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("synthetic.vault");
        let mut vault =
            crate::vault::Vault::create(path.clone(), "synthetic test passphrase").unwrap();
        vault.commit(data.clone()).unwrap();
        assert!(api.flush(&mut data).await.is_err());
        assert_eq!(data.pending.len(), 1);
        drop(vault);
        let vault = crate::vault::Vault::unlock(path, "synthetic test passphrase").unwrap();
        data = vault.data.clone();
        api.refresh(&mut data, false).await.unwrap();
        api.flush(&mut data).await.unwrap();
        assert!(data.pending.is_empty());
        assert_eq!(mock.lock().await.writes.len(), 1);
        server.abort();
    }

    #[tokio::test]
    async fn external_edits_and_deletions_are_conflicts_not_overwritten() {
        let (api, mock, mut data, server) = setup().await;
        mock.lock().await.transactions[0].category_id = Some("external-category".into());
        api.refresh(&mut data, false).await.unwrap();
        assert!(api.flush(&mut data).await.is_err());
        assert!(data.pending[0].conflict);
        assert!(mock.lock().await.writes.is_empty());
        mock.lock().await.transactions[0].deleted = true;
        api.refresh(&mut data, false).await.unwrap();
        assert!(api.flush(&mut data).await.is_err());
        assert!(mock.lock().await.writes.is_empty());
        server.abort();
    }

    #[tokio::test]
    async fn special_transactions_never_send_payee_or_category_and_undo_restores_original() {
        let (api, mock, mut data, server) = setup().await;
        data.pending[0].before.transfer_account_id = Some("other-account".into());
        data.pending[0].change.category_id = data.pending[0].before.category_id.clone();
        mock.lock().await.transactions[0] = data.pending[0].before.clone();
        data.undo.push(data.pending[0].clone());
        api.refresh(&mut data, false).await.unwrap();
        api.flush(&mut data).await.unwrap();
        assert!(data.pending.is_empty());
        assert!(
            mock.lock().await.writes[0]["transactions"][0]
                .get("category_id")
                .is_none()
        );
        crate::undo(&mut data).unwrap();
        api.refresh(&mut data, false).await.unwrap();
        api.flush(&mut data).await.unwrap();
        assert!(!data.transactions[0].approved);
        server.abort();
    }
}
