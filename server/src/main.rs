mod amazon;
mod keystore;
mod model;
mod purchase_history;
mod suggest;
mod vault;
mod ynab;

use axum::{
    Json, Router,
    extract::{DefaultBodyLimit, Path, Request, State},
    http::{HeaderMap, HeaderValue, StatusCode},
    middleware::{self, Next},
    response::{IntoResponse, Response},
    routing::{get, post},
};
use model::*;
use rand::{RngCore, rngs::OsRng};
use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    path::PathBuf,
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::Mutex;
use tower_http::services::ServeDir;
use zeroize::{Zeroize, ZeroizeOnDrop, Zeroizing};

const IDLE: Duration = Duration::from_secs(6 * 60 * 60);
type Shared = Arc<Mutex<App>>;
struct App {
    path: PathBuf,
    legacy_path: Option<PathBuf>,
    keys: Arc<dyn keystore::KeyStore>,
    session: Option<Session>,
    ynab: ynab::Ynab,
    last_unlock: Option<Instant>,
}
struct Session {
    bearer: Zeroizing<String>,
    vault: vault::Vault,
    active: Instant,
}

#[derive(Debug)]
struct Error(StatusCode, String);
impl From<String> for Error {
    fn from(e: String) -> Self {
        Self(StatusCode::BAD_REQUEST, e)
    }
}
impl From<&str> for Error {
    fn from(e: &str) -> Self {
        e.to_string().into()
    }
}
impl IntoResponse for Error {
    fn into_response(self) -> Response {
        (self.0, Json(json!({"error": self.1}))).into_response()
    }
}
type Result<T> = std::result::Result<T, Error>;

fn authorize<'a>(app: &'a mut App, headers: &HeaderMap) -> Result<&'a mut Session> {
    if app
        .session
        .as_ref()
        .is_some_and(|s| s.active.elapsed() >= IDLE)
    {
        app.session = None;
    }
    let s = app
        .session
        .as_mut()
        .ok_or(Error(StatusCode::UNAUTHORIZED, "Vault locked".into()))?;
    let incoming = headers
        .get("x-session")
        .and_then(|h| h.to_str().ok())
        .unwrap_or("");
    let matches = incoming.len() == s.bearer.len()
        && incoming
            .bytes()
            .zip(s.bearer.bytes())
            .fold(0u8, |diff, (a, b)| diff | (a ^ b))
            == 0;
    if !matches {
        return Err(Error(StatusCode::UNAUTHORIZED, "Vault locked".into()));
    }
    s.active = Instant::now();
    Ok(s)
}

fn category_transaction_counts(d: &Data) -> std::collections::HashMap<&str, usize> {
    let mut counts = std::collections::HashMap::new();
    for transaction in d.transactions.iter().filter(|t| !t.deleted) {
        // Count each transaction once per category, including split allocations.
        let categories: std::collections::HashSet<&str> = transaction
            .category_id
            .as_deref()
            .into_iter()
            .chain(
                transaction
                    .subtransactions
                    .iter()
                    .filter(|s| !s.deleted)
                    .filter_map(|s| s.category_id.as_deref()),
            )
            .collect();
        for category in categories {
            *counts.entry(category).or_insert(0) += 1;
        }
    }
    counts
}

fn snapshot(d: &Data) -> Value {
    let mut queue: Vec<_> = d
        .transactions
        .iter()
        .filter(|t| {
            t.account_id == d.account_id
                && !t.approved
                && !t.deleted
                && !d
                    .pending
                    .iter()
                    .any(|p| p.change.id == t.id && !p.change.memo_only)
        })
        .map(|t| {
            let mut displayed = t.clone();
            if let Some(pending) = d
                .pending
                .iter()
                .find(|p| p.change.id == t.id && p.change.memo_only)
            {
                displayed.memo = pending.change.memo.clone();
            }
            displayed
        })
        .collect();
    queue.sort_by(|a, b| a.date.cmp(&b.date).then_with(|| a.id.cmp(&b.id)));
    let cycle = d
        .review_cycles
        .iter()
        .find(|c| c.account_id == d.account_id);
    let mut review_rows: Vec<_> = d
        .transactions
        .iter()
        .filter(|t| {
            t.account_id == d.account_id
                && !t.deleted
                && (queue.iter().any(|q| q.id == t.id)
                    || cycle.is_some_and(|c| c.ids.contains(&t.id)))
        })
        .cloned()
        .collect();
    for row in &mut review_rows {
        if let Some(p) = d.pending.iter().find(|p| p.change.id == row.id) {
            row.approved = p.change.approved;
            if let Some(memo) = &p.change.memo {
                row.memo = Some(memo.clone());
            }
            if !p.change.memo_only {
                row.payee_id = p.change.payee_id.clone();
                row.category_id = p.change.category_id.clone();
                row.payee_name = p.change.payee_name.clone().or_else(|| {
                    d.payees
                        .iter()
                        .find(|v| Some(&v.id) == row.payee_id.as_ref())
                        .map(|v| v.name.clone())
                });
                row.category_name = d
                    .categories
                    .iter()
                    .find(|v| Some(&v.id) == row.category_id.as_ref())
                    .map(|v| v.name.clone());
            }
        }
    }
    review_rows.sort_by(|a, b| a.date.cmp(&b.date).then_with(|| a.id.cmp(&b.id)));
    json!({"connected": !d.token.is_empty(), "plans": d.plans, "plan_id": d.plan_id,
        "account_id": d.account_id, "accounts": d.accounts.iter().filter(|a| !a.deleted && !a.closed).collect::<Vec<_>>(),
        "category_transaction_counts": category_transaction_counts(d),
        "categories": d.categories.iter().filter(|c| !c.hidden && !c.deleted).collect::<Vec<_>>(),
        "purchase_history_rules": purchase_history::rules(),
        "payees": d.payees.iter().filter(|p| !p.deleted && p.transfer_account_id.is_none()).collect::<Vec<_>>(),
        "description_pending": d.pending.iter().filter(|p| p.change.memo_only).map(|p| &p.change.id).collect::<Vec<_>>(),
        "amazon_assignments": d.amazon_assignments,
        "amazon_targets": d.transactions.iter().filter(|t| !t.deleted && !t.approved && t.transfer_account_id.is_none() && !d.pending.iter().any(|p| p.change.id == t.id && !p.change.memo_only && p.change.approved && !p.conflict)).collect::<Vec<_>>(),
        "review_rows": review_rows, "queue": queue, "pending": d.pending.len(), "conflicts": d.pending.iter().filter(|p| p.conflict).count(),
        "undo_transactions": d.undo.iter().map(|p| &p.before).collect::<Vec<_>>(),
        "business_expenses": d.business_expenses,
        "can_undo_business": !d.business_undo.is_empty() || !d.business_archive_undo.is_empty(),
        "can_undo_archive": matches!(d.business_undo.last(), Some(BusinessUndo::Archived { .. })) || (d.business_undo.is_empty() && !d.business_archive_undo.is_empty()),
        "can_undo": !d.undo.is_empty(), "synced_at": d.synced_at,
        "history_count": d.transactions.iter().filter(|t| t.approved && !t.deleted).count()})
}

async fn status(State(state): State<Shared>) -> Result<Json<Value>> {
    let app = state.lock().await;
    let source = if app.path.exists() {
        Some(&app.path)
    } else {
        app.legacy_path.as_ref()
    };
    let migration = source
        .map(|p| vault::Vault::is_legacy(p))
        .transpose()?
        .unwrap_or(false);
    Ok(Json(
        json!({"exists": source.is_some(), "mode": if migration { "migration" } else if cfg!(target_os = "macos") || cfg!(feature = "synthetic-tests") { "macos" } else { "unsupported" }}),
    ))
}

#[derive(Deserialize, Zeroize, ZeroizeOnDrop)]
#[serde(deny_unknown_fields)]
struct Unlock {
    #[serde(default)]
    legacy_passphrase: Option<String>,
}
async fn unlock(State(state): State<Shared>, Json(body): Json<Unlock>) -> Result<Json<Value>> {
    let mut app = state.lock().await;
    if app
        .last_unlock
        .is_some_and(|t| t.elapsed() < Duration::from_secs(2))
    {
        return Err(Error(
            StatusCode::TOO_MANY_REQUESTS,
            "Wait a moment before trying again".into(),
        ));
    }
    app.last_unlock = Some(Instant::now());
    let path = app.path.clone();
    let password = body
        .legacy_passphrase
        .as_ref()
        .map(|s| Zeroizing::new(s.clone()));
    let source = if path.exists() {
        Some(path.clone())
    } else {
        app.legacy_path.clone()
    };
    let keys = app.keys.clone();
    // Concurrent unlock requests share the mutex, but each successful browser
    // session reads through Keychain. Signed Trilly builds are trusted; the key
    // is never cached outside an unlocked Rust session.
    let vault = tokio::task::spawn_blocking(move || match source {
        Some(source) if vault::Vault::is_legacy(&source)? => {
            let password = password
                .as_ref()
                .ok_or("Enter your existing vault passphrase once to migrate")?;
            vault::Vault::migrate(source, path, password, keys.as_ref())
        }
        Some(source) => {
            if password.is_some() {
                return Err(
                    "macOS handles authentication; do not send your Mac password to Trilly".into(),
                );
            }
            let mut opened = vault::Vault::open_native(source, keys.as_ref())?;
            if opened.path != path {
                opened.path = path;
                opened.save(&opened.data)?;
            }
            Ok(opened)
        }
        None => {
            if password.is_some() {
                return Err(
                    "macOS handles authentication; do not send your Mac password to Trilly".into(),
                );
            }
            vault::Vault::create_native(path, keys.as_ref())
        }
    })
    .await
    .map_err(|_| "Could not unlock vault")??;
    let mut random = [0u8; 32];
    OsRng.fill_bytes(&mut random);
    let bearer = Zeroizing::new(
        random
            .iter()
            .map(|b| format!("{b:02x}"))
            .collect::<String>(),
    );
    random.zeroize();
    let result = json!({"session": *bearer, "state": snapshot(&vault.data)});
    app.legacy_path = None;
    app.session = Some(Session {
        bearer,
        vault,
        active: Instant::now(),
    });
    Ok(Json(result))
}

async fn state_view(State(state): State<Shared>, headers: HeaderMap) -> Result<Json<Value>> {
    let mut app = state.lock().await;
    Ok(Json(snapshot(&authorize(&mut app, &headers)?.vault.data)))
}
async fn suggestions(
    State(state): State<Shared>,
    headers: HeaderMap,
    Path(id): Path<String>,
) -> Result<Json<Value>> {
    let mut app = state.lock().await;
    let d = &authorize(&mut app, &headers)?.vault.data;
    let t = d
        .transactions
        .iter()
        .find(|t| t.id == id)
        .ok_or("Transaction not found")?;
    Ok(Json(json!(suggest::suggestions(d, t))))
}

async fn amazon_view(State(state): State<Shared>, headers: HeaderMap) -> Result<Json<Value>> {
    let mut app = state.lock().await;
    let d = &authorize(&mut app, &headers)?.vault.data;
    Ok(Json(
        json!({"plan_id": d.plan_id, "payments": d.amazon.payments, "orders": d.amazon.orders, "collected_targets": d.amazon_collected_targets}),
    ))
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AmazonImport {
    plan_id: String,
    #[serde(default)]
    completed_targets: Vec<String>,
    #[serde(default)]
    clear: bool,
    #[serde(default)]
    payments: Vec<amazon::Payment>,
    #[serde(default)]
    orders: Vec<amazon::Order>,
}
async fn amazon_import(
    State(state): State<Shared>,
    headers: HeaderMap,
    Json(body): Json<AmazonImport>,
) -> Result<Json<Value>> {
    let mut app = state.lock().await;
    let session = authorize(&mut app, &headers)?;
    if body.plan_id.is_empty() || body.plan_id != session.vault.data.plan_id {
        return Err("Amazon collection belongs to another plan".into());
    }
    let mut next = session.vault.data.clone();
    if body.clear {
        next.amazon = amazon::Store::default();
        next.amazon_assignments.clear();
        next.amazon_collected_targets.clear();
    }
    next.amazon.merge(amazon::Store {
        payments: body.payments,
        orders: body.orders,
    })?;
    if body.completed_targets.len() > 10000 {
        return Err("Too many Amazon review targets".into());
    }
    for id in body.completed_targets {
        if next
            .transactions
            .iter()
            .any(|t| t.id == id && !t.deleted && !t.approved)
            && !next.amazon_collected_targets.contains(&id)
        {
            next.amazon_collected_targets.push(id);
        }
    }
    // A late collector packet must not repopulate a finished review.
    let retained = !amazon_review_finished(&next);
    if !retained {
        clear_amazon(&mut next);
    }
    session.vault.commit(next)?;
    Ok(Json(json!({"saved": true, "retained": retained})))
}

// Consider the entire plan, including transfers and other accounts. Pending
// approvals, undo writes and conflicts must be confirmed before deleting evidence.
fn amazon_review_finished(data: &Data) -> bool {
    !data.plan_id.is_empty()
        && data.pending.is_empty()
        && !data.transactions.iter().any(|t| !t.deleted && !t.approved)
}

fn clear_amazon(data: &mut Data) {
    data.amazon = amazon::Store::default();
    data.amazon_assignments.clear();
    data.amazon_collected_targets.clear();
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct BusinessExpenseInput {
    expense_id: String,
    #[serde(default)]
    product_key: String,
    description: String,
    amount: i64,
    note: String,
}

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
enum Action {
    BusinessExpense {
        id: String,
        description: String,
        note: String,
        amount: Option<i64>,
    },
    ReplaceBusinessExpenses {
        id: String,
        expenses: Vec<BusinessExpenseInput>,
    },
    EditBusinessExpense {
        plan_id: String,
        id: String,
        description: String,
        date: String,
        amount: i64,
        account: String,
        note: String,
    },
    ArchiveBusinessExpenses,
    UndoBusinessArchive,
    UndoBusinessExpense,
    RemoveBusinessExpense {
        plan_id: String,
        id: String,
    },
    Lock,
    Token {
        token: Zeroizing<String>,
    },
    Plan {
        id: String,
    },
    Account {
        id: String,
    },
    Description {
        id: String,
        description: String,
    },
    Review {
        id: String,
        #[serde(default)]
        memo: Option<String>,
        #[serde(default)]
        amazon_marketplace: Option<String>,
        #[serde(default)]
        amazon_payment_id: Option<String>,
        #[serde(default)]
        payee_name: Option<String>,
        payee_id: Option<String>,
        category_id: Option<String>,
    },
    RenamePayee {
        id: String,
        name: String,
    },
    Undo,
    DiscardConflicts,
    Sync {
        #[serde(default)]
        full: bool,
    },
}

fn resolve_payee_name(
    payees: &[Payee],
    payee_id: &mut Option<String>,
    name: &str,
) -> Result<Option<String>> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 200 {
        return Err("Payee name must contain 1 to 200 characters".into());
    }
    *payee_id = payees
        .iter()
        .find(|p| {
            !p.deleted && p.transfer_account_id.is_none() && p.name.eq_ignore_ascii_case(name)
        })
        .map(|p| p.id.clone());
    Ok(if payee_id.is_none() {
        Some(name.to_owned())
    } else {
        None
    })
}

async fn action(
    State(state): State<Shared>,
    headers: HeaderMap,
    Json(body): Json<Action>,
) -> Result<Json<Value>> {
    let mut app = state.lock().await;
    authorize(&mut app, &headers)?;
    if matches!(body, Action::Lock) {
        app.session = None;
        return Ok(Json(json!({"locked": true})));
    }
    let mut next = app.session.as_ref().unwrap().vault.data.clone();
    next.update_review_cycles();
    let mut sync_error = None;
    let mut amazon_cleared = false;
    let is_sync = matches!(body, Action::Sync { .. });
    match body {
        Action::Lock => unreachable!(),
        Action::BusinessExpense {
            id,
            description,
            note,
            amount,
        } => save_business_expense(&mut next, &id, description, note, amount)?,
        Action::ReplaceBusinessExpenses { id, expenses } => {
            replace_business_expenses(&mut next, &id, expenses)?
        }
        Action::EditBusinessExpense {
            plan_id,
            id,
            description,
            date,
            amount,
            account,
            note,
        } => edit_business_expense(
            &mut next,
            &plan_id,
            &id,
            description,
            date,
            amount,
            account,
            note,
        )?,
        Action::ArchiveBusinessExpenses => archive_business_expenses(&mut next),
        Action::UndoBusinessArchive | Action::UndoBusinessExpense => {
            undo_business_expense(&mut next)?
        }
        Action::RemoveBusinessExpense { plan_id, id } => {
            remove_business_expense(&mut next, &plan_id, &id)?
        }
        Action::Token { token } => {
            if !next.pending.is_empty() {
                return Err("Sync or undo pending changes before replacing the token".into());
            }
            let plans = app.ynab.plans(token.trim()).await?;
            // A replacement token may belong to another user. Start a fresh cache.
            let expenses = std::mem::take(&mut next.business_expenses);
            let archive_undo = std::mem::take(&mut next.business_archive_undo);
            let business_undo = std::mem::take(&mut next.business_undo);
            next = Data::default();
            next.business_expenses = expenses;
            next.business_archive_undo = archive_undo;
            next.business_undo = business_undo;
            next.token = token.trim().into();
            next.plans = plans;
        }
        Action::Plan { id } => {
            if !next.pending.is_empty() {
                return Err("Sync or undo pending changes before switching plans".into());
            }
            if !next.plans.iter().any(|p| p.id == id) {
                return Err("Unknown plan".into());
            }
            let token = next.token.clone();
            let plans = next.plans.clone();
            let expenses = std::mem::take(&mut next.business_expenses);
            let archive_undo = std::mem::take(&mut next.business_archive_undo);
            let business_undo = std::mem::take(&mut next.business_undo);
            next = Data::default();
            next.business_expenses = expenses;
            next.business_archive_undo = archive_undo;
            next.business_undo = business_undo;
            next.token = token;
            next.plans = plans;
            next.plan_id = id;
            app.ynab.refresh(&mut next, true).await?;
            if let Some(account) = next.accounts.iter().find(|a| !a.closed && !a.deleted) {
                next.account_id = account.id.clone();
            }
        }
        Action::Account { id } => {
            if !next
                .accounts
                .iter()
                .any(|a| a.id == id && !a.deleted && !a.closed)
            {
                return Err("Unknown account".into());
            }
            next.account_id = id;
        }
        Action::Description { id, description } => save_description(&mut next, &id, description)?,
        Action::Review {
            id,
            memo,
            amazon_marketplace,
            amazon_payment_id,
            mut payee_id,
            payee_name,
            category_id,
        } => {
            if let Some(payment_id) = &amazon_payment_id {
                if !next.amazon.payments.iter().any(|p| p.id == *payment_id) {
                    return Err("Amazon payment not found".into());
                }
                if next
                    .amazon_assignments
                    .iter()
                    .any(|a| a.payment_id == *payment_id && a.transaction_id != id)
                {
                    return Err(
                        "This Amazon payment is already assigned to another transaction".into(),
                    );
                }
            }
            if payee_name.is_some() && (amazon_marketplace.is_some() || payee_id.is_some()) {
                return Err("Choose either an existing payee or a new payee name".into());
            }
            if amazon_marketplace
                .as_ref()
                .is_some_and(|market| !matches!(market.as_str(), "amazon.ca" | "amazon.com"))
            {
                return Err("Invalid Amazon marketplace".into());
            }
            let payee_name = match payee_name.or(amazon_marketplace) {
                Some(name) => resolve_payee_name(&next.payees, &mut payee_id, &name)?,
                None => None,
            };
            if memo
                .as_ref()
                .is_some_and(|value| value.chars().count() > 500)
            {
                return Err("Description must be 500 characters or fewer".into());
            }
            let t = next
                .transactions
                .iter()
                .find(|t| {
                    t.id == id && t.account_id == next.account_id && !t.deleted && !t.approved
                })
                .ok_or("Transaction is no longer awaiting approval")?;
            if next.pending.iter().any(|p| p.change.id == id) {
                return Err("Transaction already queued".into());
            }
            if t.special()
                && (payee_name.is_some() || t.payee_id != payee_id || t.category_id != category_id)
            {
                return Err("Edit splits, transfers and reconciled transactions in YNAB".into());
            }
            if !t.special() {
                if !category_id.as_ref().is_some_and(|id| {
                    t.category_id.as_ref() == Some(id)
                        || next
                            .categories
                            .iter()
                            .any(|c| c.id == *id && !c.hidden && !c.deleted)
                }) {
                    return Err("Choose a category".into());
                }
                if payee_name.is_none()
                    && !payee_id.as_ref().is_some_and(|id| {
                        next.payees
                            .iter()
                            .any(|p| p.id == *id && !p.deleted && p.transfer_account_id.is_none())
                    })
                {
                    return Err("Choose a payee".into());
                }
            }
            let pending = Pending {
                before: t.clone(),
                change: Change {
                    payee_name,
                    memo,
                    memo_only: false,
                    id: id.clone(),
                    payee_id,
                    category_id,
                    approved: true,
                },
                conflict: false,
            };
            next.pending.push(pending.clone());
            if let Some(payment_id) = amazon_payment_id {
                next.amazon_assignments.retain(|a| a.transaction_id != id);
                next.amazon_assignments.push(amazon::Assignment {
                    payment_id,
                    transaction_id: id.clone(),
                });
            }
            next.undo.push(pending);
            if next.undo.len() > 100 {
                next.undo.remove(0);
            }
        }
        Action::RenamePayee { id, name } => app.ynab.rename_payee(&mut next, &id, &name).await?,
        Action::Undo => undo(&mut next)?,
        Action::DiscardConflicts => {
            let ids: Vec<_> = next
                .pending
                .iter()
                .filter(|p| p.conflict)
                .map(|p| p.change.id.clone())
                .collect();
            next.pending.retain(|p| !p.conflict);
            next.undo.retain(|p| !ids.contains(&p.change.id));
            next.amazon_assignments
                .retain(|a| !ids.contains(&a.transaction_id));
        }
        Action::Sync { full } => {
            if next.token.is_empty() {
                return Err("Connect YNAB first".into());
            }
            if next.plan_id.is_empty() {
                return Err("Choose a plan first".into());
            }
            // Refresh before writes to detect external edits. YNAB has no conditional
            // transaction writes; a small race remains between this read and PATCH.
            match app.ynab.refresh(&mut next, full).await {
                Ok(()) => {
                    if let Err(error) = app.ynab.flush(&mut next).await {
                        sync_error = Some(error);
                    }
                }
                Err(error) => sync_error = Some(error),
            }
        }
    }
    if is_sync && sync_error.is_none() && amazon_review_finished(&next) {
        clear_amazon(&mut next);
        amazon_cleared = true;
    }
    next.update_review_cycles();
    app.session.as_mut().unwrap().vault.commit(next)?;
    let mut result = snapshot(&app.session.as_ref().unwrap().vault.data);
    result["amazon_cleared"] = json!(amazon_cleared);
    if let Some(error) = sync_error {
        result["sync_error"] = json!(error);
    }
    Ok(Json(result))
}

fn save_description(data: &mut Data, id: &str, description: String) -> Result<()> {
    if description.chars().count() > 500 {
        return Err("Description must be 500 characters or fewer".into());
    }
    if data.pending.iter().any(|p| p.change.id == id) {
        return Err("Sync the pending change before editing this description".into());
    }
    let before = data
        .transactions
        .iter()
        .find(|t| t.id == id && t.account_id == data.account_id && !t.deleted && !t.approved)
        .ok_or("Transaction is no longer awaiting approval")?;
    if before.memo.as_deref().unwrap_or("") == description {
        return Ok(());
    }
    let mut change = Change::from(before);
    change.memo = Some(description);
    change.memo_only = true;
    let pending = Pending {
        before: before.clone(),
        change,
        conflict: false,
    };
    data.pending.push(pending.clone());
    data.undo.push(pending);
    if data.undo.len() > 100 {
        data.undo.remove(0);
    }
    Ok(())
}

fn save_business_expense(
    data: &mut Data,
    id: &str,
    description: String,
    note: String,
    amount: Option<i64>,
) -> Result<()> {
    if description.trim().is_empty() {
        return Err("Description is required".into());
    }
    if description.len() > 10000 || note.len() > 10000 {
        return Err("Description or note is too long".into());
    }
    if let Some(index) = data
        .business_expenses
        .iter()
        .position(|e| e.plan_id == data.plan_id && e.transaction_id == id)
    {
        let previous = data.business_expenses[index].clone();
        data.business_expenses[index].description = description.trim().into();
        data.business_expenses[index].note = note;
        if let Some(amount) = amount {
            data.business_expenses[index].amount = amount;
        }
        remember_business(data, BusinessUndo::Updated { expense: previous });
        return Ok(());
    }
    let transaction = data
        .transactions
        .iter()
        .find(|t| t.id == id && !t.deleted)
        .ok_or("Transaction not found")?;
    let account = data
        .accounts
        .iter()
        .find(|a| a.id == transaction.account_id)
        .ok_or("Account not found")?;
    let expense = model::BusinessExpense {
        expense_id: String::new(),
        product_key: String::new(),
        plan_id: data.plan_id.clone(),
        transaction_id: id.into(),
        description: description.trim().into(),
        date: transaction.date.clone(),
        amount: match amount {
            Some(amount) => amount,
            None => transaction.amount.checked_neg().ok_or("Invalid amount")?,
        },
        account: account.name.clone(),
        note,
        archived: false,
    };
    remember_business(
        data,
        BusinessUndo::Added {
            plan_id: expense.plan_id.clone(),
            transaction_id: expense.transaction_id.clone(),
        },
    );
    data.business_expenses.push(expense);
    Ok(())
}

fn replace_business_expenses(
    data: &mut Data,
    id: &str,
    rows: Vec<BusinessExpenseInput>,
) -> Result<()> {
    if rows.len() > 100 {
        return Err("Too many expense rows".into());
    }
    let transaction = data
        .transactions
        .iter()
        .find(|t| t.id == id && !t.deleted)
        .ok_or("Transaction not found")?;
    let account = data
        .accounts
        .iter()
        .find(|a| a.id == transaction.account_id)
        .ok_or("Account not found")?;
    let previous: Vec<_> = data
        .business_expenses
        .iter()
        .enumerate()
        .filter(|(_, e)| e.plan_id == data.plan_id && e.transaction_id == id)
        .map(|(i, e)| (i, e.clone()))
        .collect();
    let mut keys = std::collections::HashSet::new();
    let mut updated = Vec::new();
    for row in rows {
        if row.expense_id.len() > 200
            || row.product_key.len() > 1000
            || row.description.trim().is_empty()
            || row.description.len() > 10000
            || row.note.len() > 10000
        {
            return Err("Invalid expense row".into());
        }
        let existing = previous
            .iter()
            .find(|(_, e)| e.expense_id == row.expense_id);
        if existing.is_none() && row.expense_id.is_empty() {
            return Err("Expense row ID is required".into());
        }
        let combined = previous
            .first()
            .filter(|(_, e)| previous.len() == 1 && e.product_key.is_empty());
        let mut expense =
            existing
                .map(|(_, e)| e.clone())
                .unwrap_or_else(|| model::BusinessExpense {
                    expense_id: row.expense_id,
                    plan_id: data.plan_id.clone(),
                    transaction_id: id.into(),
                    date: combined
                        .map_or_else(|| transaction.date.clone(), |(_, e)| e.date.clone()),
                    account: combined
                        .map_or_else(|| account.name.clone(), |(_, e)| e.account.clone()),
                    archived: combined.is_some_and(|(_, e)| e.archived),
                    ..Default::default()
                });
        if !keys.insert(expense.key().to_owned())
            || data.business_expenses.iter().any(|e| {
                e.plan_id == data.plan_id && e.transaction_id != id && e.key() == expense.key()
            })
        {
            return Err("Expense row ID already exists".into());
        }
        expense.product_key = row.product_key;
        expense.description = row.description.trim().into();
        expense.amount = row.amount;
        expense.note = row.note;
        updated.push(expense);
    }
    let plan_id = data.plan_id.clone();
    remember_business(
        data,
        BusinessUndo::Replaced {
            plan_id: plan_id.clone(),
            transaction_id: id.into(),
            expenses: previous,
        },
    );
    data.business_expenses
        .retain(|e| e.plan_id != plan_id || e.transaction_id != id);
    data.business_expenses.extend(updated);
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn edit_business_expense(
    data: &mut Data,
    plan_id: &str,
    id: &str,
    description: String,
    date: String,
    amount: i64,
    account: String,
    note: String,
) -> Result<()> {
    if description.trim().is_empty() || account.trim().is_empty() {
        return Err("Description and account are required".into());
    }
    if description.len() > 10000 || account.len() > 1000 || note.len() > 10000 {
        return Err("Business expense field is too long".into());
    }
    if chrono::NaiveDate::parse_from_str(&date, "%Y-%m-%d").is_err() {
        return Err("Date must use yyyy-mm-dd".into());
    }
    let index = data
        .business_expenses
        .iter()
        .position(|e| e.plan_id == plan_id && e.key() == id)
        .ok_or("Business expense not found")?;
    let previous = data.business_expenses[index].clone();
    let expense = &mut data.business_expenses[index];
    expense.description = description.trim().into();
    expense.date = date;
    expense.amount = amount;
    expense.account = account.trim().into();
    expense.note = note;
    remember_business(data, BusinessUndo::Updated { expense: previous });
    Ok(())
}

fn archive_business_expenses(data: &mut Data) {
    let indices: Vec<_> = data
        .business_expenses
        .iter()
        .enumerate()
        .filter(|(_, e)| !e.archived)
        .map(|(i, _)| i)
        .collect();
    if indices.is_empty() {
        return;
    }
    let keys = indices
        .iter()
        .map(|&i| {
            let e = &data.business_expenses[i];
            (e.plan_id.clone(), e.key().to_owned())
        })
        .collect();
    remember_business(data, BusinessUndo::Archived { keys });
    for &index in &indices {
        data.business_expenses[index].archived = true;
    }
}

// Convert the previous index-based archive undo before rows can be removed.
fn migrate_business_undo(data: &mut Data) {
    let keys: Vec<_> = std::mem::take(&mut data.business_archive_undo)
        .into_iter()
        .filter_map(|i| data.business_expenses.get(i))
        .map(|e| (e.plan_id.clone(), e.key().to_owned()))
        .collect();
    if !keys.is_empty() {
        data.business_undo.push(BusinessUndo::Archived { keys });
    }
}

fn remember_business(data: &mut Data, change: BusinessUndo) {
    migrate_business_undo(data);
    data.business_undo.push(change);
    if data.business_undo.len() > 100 {
        data.business_undo.remove(0);
    }
}

fn remove_business_expense(data: &mut Data, plan_id: &str, id: &str) -> Result<()> {
    let index = data
        .business_expenses
        .iter()
        .position(|e| e.plan_id == plan_id && e.key() == id)
        .ok_or("Business expense not found")?;
    migrate_business_undo(data);
    let expense = data.business_expenses.remove(index);
    remember_business(data, BusinessUndo::Removed { expense, index });
    Ok(())
}

fn undo_business_expense(data: &mut Data) -> Result<()> {
    migrate_business_undo(data);
    match data
        .business_undo
        .pop()
        .ok_or("No business expense change to undo")?
    {
        BusinessUndo::Replaced {
            plan_id,
            transaction_id,
            expenses,
        } => {
            data.business_expenses
                .retain(|e| e.plan_id != plan_id || e.transaction_id != transaction_id);
            for (index, expense) in expenses {
                data.business_expenses
                    .insert(index.min(data.business_expenses.len()), expense);
            }
        }
        BusinessUndo::Added {
            plan_id,
            transaction_id,
        } => {
            data.business_expenses
                .retain(|e| e.plan_id != plan_id || e.key() != transaction_id);
        }
        BusinessUndo::Removed { expense, index } => {
            data.business_expenses
                .insert(index.min(data.business_expenses.len()), expense);
        }
        BusinessUndo::Updated { expense } => {
            let saved = data
                .business_expenses
                .iter_mut()
                .find(|e| e.plan_id == expense.plan_id && e.key() == expense.key())
                .ok_or("Business expense not found")?;
            *saved = expense;
        }
        BusinessUndo::Archived { keys } => {
            for expense in &mut data.business_expenses {
                if keys
                    .iter()
                    .any(|(plan, id)| *plan == expense.plan_id && *id == expense.key())
                {
                    expense.archived = false;
                }
            }
        }
    }
    Ok(())
}

fn undo(data: &mut Data) -> Result<()> {
    let previous = data.undo.last().ok_or("Nothing to undo")?.clone();
    if !previous.change.memo_only {
        data.amazon_assignments
            .retain(|a| a.transaction_id != previous.change.id);
    }
    if let Some(index) = data
        .pending
        .iter()
        .position(|p| p.change.id == previous.change.id)
    {
        // Even a request whose response was lost might already have been applied.
        // Queue the reverse against its expected remote result; flush either sees
        // the original state (already undone) or safely sends the reverse update.
        let pending = data.pending.remove(index);
        if pending.conflict {
            data.undo.pop();
            return Ok(());
        }
    }
    let mut applied = previous.before.clone();
    applied.approved = previous.change.approved;
    applied.payee_id = previous.change.payee_id.clone();
    if let Some(name) = &previous.change.payee_name {
        applied.payee_name = Some(name.clone());
        applied.payee_id = data
            .transactions
            .iter()
            .find(|t| t.id == applied.id && t.matches_change(&previous.change))
            .and_then(|t| t.payee_id.clone());
    }
    applied.category_id = previous.change.category_id.clone();
    let mut reverse = Change::from(&previous.before);
    if previous.change.memo.is_some() {
        applied.memo = previous.change.memo.clone();
        reverse.memo = Some(previous.before.memo.clone().unwrap_or_default());
        reverse.memo_only = previous.change.memo_only;
    }
    data.pending.push(Pending {
        before: applied,
        change: reverse,
        conflict: false,
    });
    data.undo.pop();
    Ok(())
}

async fn boundary(State(origin): State<String>, req: Request, next: Next) -> Response {
    let host = req
        .headers()
        .get("host")
        .and_then(|h| h.to_str().ok())
        .unwrap_or("");
    let expected_host = origin.trim_start_matches("http://");
    let supplied_origin = req.headers().get("origin").and_then(|h| h.to_str().ok());
    let cross_site = req
        .headers()
        .get("sec-fetch-site")
        .is_some_and(|h| h == "cross-site");
    let api = req.uri().path().starts_with("/api/");
    let marker = req.headers().get("x-trilly").is_some_and(|h| h == "1");
    let mut response = if host != expected_host
        || supplied_origin.is_some_and(|o| o != origin)
        || cross_site
        || (api && !marker)
    {
        (StatusCode::FORBIDDEN, "Request blocked").into_response()
    } else {
        next.run(req).await
    };
    let headers = response.headers_mut();
    headers.insert("cache-control", HeaderValue::from_static("no-store"));
    headers.insert(
        "x-content-type-options",
        HeaderValue::from_static("nosniff"),
    );
    headers.insert("referrer-policy", HeaderValue::from_static("no-referrer"));
    headers.insert("x-frame-options", HeaderValue::from_static("DENY"));
    headers.insert("content-security-policy", HeaderValue::from_static(
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'; object-src 'none'"));
    response
}

fn router(shared: Shared, origin: String, dist: PathBuf) -> Router {
    Router::new()
        .route("/api/status", get(status))
        .route("/api/unlock", post(unlock))
        .route("/api/state", get(state_view))
        .route("/api/action", post(action))
        .route("/api/suggestions/{id}", get(suggestions))
        .route(
            "/api/amazon",
            get(amazon_view)
                .post(amazon_import)
                .layer(DefaultBodyLimit::max(2 * 1024 * 1024)),
        )
        .fallback_service(ServeDir::new(dist))
        .layer(DefaultBodyLimit::max(32 * 1024))
        .layer(middleware::from_fn_with_state(origin, boundary))
        .with_state(shared)
}

#[tokio::main]
async fn main() -> std::result::Result<(), Box<dyn std::error::Error>> {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .to_path_buf();
    let ports = serde_json::from_str::<Value>(include_str!("../../port.json"))?;
    let dev = cfg!(debug_assertions) && std::env::var("TRILLY_DEV").as_deref() == Ok("1");
    let port = ports[if dev && cfg!(feature = "synthetic-tests") {
        "dev_test_port"
    } else if cfg!(feature = "synthetic-tests") {
        "test_port"
    } else {
        "port"
    }]
    .as_u64()
    .unwrap() as u16;
    #[cfg(feature = "synthetic-tests")]
    if std::env::var("TRILLY_SYNTHETIC_TESTS").as_deref() != Ok("1")
        || std::env::var_os("TRILLY_DATA_DIR").is_none()
    {
        return Err("Synthetic tests require an explicit isolated data directory".into());
    }
    let custom_dir = std::env::var_os("TRILLY_DATA_DIR");
    let legacy_path = if custom_dir.is_none() {
        // Compatibility with the original app name; never create a second empty
        // vault while a user's existing encrypted history is waiting to migrate.
        let old = dirs::data_local_dir().unwrap().join("ynab-plus/data.vault");
        old.exists().then_some(old)
    } else {
        None
    };
    let data_dir = custom_dir.map(PathBuf::from).unwrap_or_else(|| {
        dirs::data_local_dir()
            .expect("Local data directory")
            .join("trilly")
    });
    std::fs::create_dir_all(&data_dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&data_dir, std::fs::Permissions::from_mode(0o700))?;
    }
    let lock_file = std::fs::OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(data_dir.join("instance.lock"))?;
    fs2::FileExt::try_lock_exclusive(&lock_file)
        .map_err(|_| "Another Trilly instance is using this vault")?;
    let legacy_lock = if !data_dir.join("data.vault").exists() {
        if let Some(old) = &legacy_path {
            let f = std::fs::OpenOptions::new()
                .create(true)
                .truncate(false)
                .write(true)
                .open(old.with_file_name("instance.lock"))?;
            fs2::FileExt::try_lock_exclusive(&f)
                .map_err(|_| "Close the previous app before migrating to Trilly")?;
            Some(f)
        } else {
            None
        }
    } else {
        None
    };
    let _legacy_lock = legacy_lock;
    #[cfg(not(feature = "synthetic-tests"))]
    let keys: Arc<dyn keystore::KeyStore> = Arc::new(keystore::MacKeyStore);
    #[cfg(feature = "synthetic-tests")]
    let keys: Arc<dyn keystore::KeyStore> = Arc::new(keystore::SyntheticKeyStore);
    let shared = Arc::new(Mutex::new(App {
        path: data_dir.join("data.vault"),
        legacy_path,
        keys,
        session: None,
        ynab: ynab::Ynab::new(),
        last_unlock: None,
    }));
    let idle_state = shared.clone();
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(Duration::from_secs(15)).await;
            let mut app = idle_state.lock().await;
            if app
                .session
                .as_ref()
                .is_some_and(|s| s.active.elapsed() >= IDLE)
            {
                app.session = None;
            }
        }
    });
    let origin = format!("http://127.0.0.1:{port}");
    let listen_port = if dev {
        ports[if cfg!(feature = "synthetic-tests") {
            "dev_test_backend_port"
        } else {
            "dev_backend_port"
        }]
        .as_u64()
        .unwrap() as u16
    } else {
        port
    };
    let listener =
        tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, listen_port)).await?;
    println!("Trilly: {origin}");
    // Installed bundles remain usable after a development worktree is removed.
    let bundled_dist = std::env::current_exe()?
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .join("Resources/dist");
    let dist = if bundled_dist.is_dir() {
        bundled_dist
    } else {
        root.join("dist")
    };
    if std::env::var("TRILLY_NO_OPEN").as_deref() != Ok("1") && !cfg!(feature = "synthetic-tests") {
        let _ = std::process::Command::new("/usr/bin/open")
            .arg(&origin)
            .spawn();
    }
    axum::serve(listener, router(shared, origin, dist))
        .with_graceful_shutdown(async {
            tokio::signal::ctrl_c().await.ok();
        })
        .await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    #[tokio::test]
    async fn review_new_payee_validates_and_queues_creation_only_on_approval() {
        for (name, existing, special, expected) in [
            ("  Cedar Workshop  ".to_string(), false, false, true),
            ("cedar workshop".to_string(), true, false, true),
            ("   ".to_string(), false, false, false),
            ("x".repeat(201), false, false, false),
            ("Cedar Workshop".to_string(), false, true, false),
        ] {
            let dir = tempfile::tempdir().unwrap();
            let path = dir.path().join("synthetic.vault");
            let mut vault =
                vault::Vault::create_native(path.clone(), &keystore::SyntheticKeyStore).unwrap();
            let mut data = Data::default();
            data.account_id = "account".into();
            data.transactions.push(Transaction {
                id: "transaction".into(),
                account_id: "account".into(),
                category_id: Some("category".into()),
                cleared: if special { "reconciled" } else { "uncleared" }.into(),
                ..Default::default()
            });
            if existing {
                data.payees.push(Payee {
                    id: "existing".into(),
                    name: "Cedar Workshop".into(),
                    ..Default::default()
                });
            }
            vault.commit(data).unwrap();
            let app = Arc::new(Mutex::new(App {
                path,
                legacy_path: None,
                keys: Arc::new(keystore::SyntheticKeyStore),
                session: Some(Session {
                    bearer: Zeroizing::new("synthetic-session".into()),
                    vault,
                    active: Instant::now(),
                }),
                ynab: ynab::Ynab::new(),
                last_unlock: None,
            }));
            let mut headers = HeaderMap::new();
            headers.insert("x-session", HeaderValue::from_static("synthetic-session"));
            let body = serde_json::from_value(json!({
                "action": "review", "id": "transaction", "payee_name": name,
                "payee_id": null, "category_id": "category"
            }))
            .unwrap();
            let result = action(State(app.clone()), headers, Json(body)).await;
            assert_eq!(result.is_ok(), expected);
            let mut locked = app.lock().await;
            let data = &mut locked.session.as_mut().unwrap().vault.data;
            assert!(!data.transactions[0].approved);
            assert_eq!(data.pending.len(), usize::from(expected));
            assert_eq!(data.payees.len(), usize::from(existing));
            if expected {
                let change = &data.pending[0].change;
                assert!(change.approved);
                assert_eq!(
                    change.payee_name.as_deref(),
                    if existing {
                        None
                    } else {
                        Some("Cedar Workshop")
                    }
                );
                assert_eq!(
                    change.payee_id.as_deref(),
                    if existing { Some("existing") } else { None }
                );
                undo(data).unwrap();
                assert!(!data.pending[0].change.approved);
                assert!(data.pending[0].change.payee_name.is_none());
            }
        }
    }

    #[test]
    fn category_counts_include_all_accounts_and_splits_but_exclude_deleted_rows() {
        let split = |category: &str, deleted| Split {
            category_id: Some(category.into()),
            deleted,
            ..Default::default()
        };
        let mut d = Data::default();
        d.account_id = "current".into();
        d.transactions = vec![
            Transaction {
                account_id: "current".into(),
                category_id: Some("food".into()),
                ..Default::default()
            },
            Transaction {
                account_id: "other".into(),
                approved: true,
                category_id: Some("food".into()),
                ..Default::default()
            },
            Transaction {
                deleted: true,
                category_id: Some("food".into()),
                subtransactions: vec![split("ignored", false)],
                ..Default::default()
            },
            Transaction {
                subtransactions: vec![
                    split("food", false),
                    split("food", false),
                    split("travel", false),
                    split("ignored", true),
                ],
                ..Default::default()
            },
            Transaction::default(),
        ];
        let result = snapshot(&d);
        assert_eq!(
            result["category_transaction_counts"],
            json!({"food": 3, "travel": 1})
        );
    }

    #[test]
    fn review_batches_survive_restart_sync_undo_and_reset_per_account() {
        let mut d = Data::default();
        d.account_id = "a".into();
        d.accounts = vec![
            Account {
                id: "a".into(),
                ..Default::default()
            },
            Account {
                id: "b".into(),
                ..Default::default()
            },
        ];
        d.transactions = vec![
            Transaction {
                id: "one".into(),
                account_id: "a".into(),
                ..Default::default()
            },
            Transaction {
                id: "two".into(),
                account_id: "a".into(),
                ..Default::default()
            },
            Transaction {
                id: "other".into(),
                account_id: "b".into(),
                ..Default::default()
            },
            Transaction {
                id: "old".into(),
                account_id: "a".into(),
                approved: true,
                ..Default::default()
            },
        ];
        d.update_review_cycles();
        assert_eq!(snapshot(&d)["review_rows"].as_array().unwrap().len(), 2);
        let before = d.transactions[0].clone();
        d.pending.push(Pending {
            change: Change {
                approved: true,
                memo: Some("Synthetic description".into()),
                ..Change::from(&before)
            },
            before,
            conflict: false,
        });
        d.update_review_cycles();
        let state = snapshot(&d);
        assert_eq!(state["queue"].as_array().unwrap().len(), 1);
        assert_eq!(state["review_rows"][0]["approved"], true);
        assert_eq!(state["review_rows"][0]["memo"], "Synthetic description");
        // Simulate a successful sync, then round-trip through an isolated encrypted vault.
        d.transactions[0].approved = true;
        d.pending.clear();
        d.update_review_cycles();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("review-batch.vault");
        let mut vault =
            vault::Vault::create_native(path.clone(), &keystore::SyntheticKeyStore).unwrap();
        vault.commit(d.clone()).unwrap();
        assert_eq!(
            snapshot(&vault.data)["review_rows"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
        drop(vault);
        let reopened = vault::Vault::open_native(path, &keystore::SyntheticKeyStore).unwrap();
        d = reopened.data.clone();
        d.transactions[1].approved = true;
        d.update_review_cycles();
        assert!(d.review_cycles[0].complete);
        assert_eq!(snapshot(&d)["review_rows"].as_array().unwrap().len(), 2);
        d.transactions[0].approved = false;
        d.update_review_cycles();
        assert!(!d.review_cycles[0].complete);
        assert_eq!(snapshot(&d)["review_rows"].as_array().unwrap().len(), 2);
        d.transactions[0].approved = true;
        d.update_review_cycles();
        d.transactions.push(Transaction {
            id: "new".into(),
            account_id: "a".into(),
            ..Default::default()
        });
        d.update_review_cycles();
        assert_eq!(snapshot(&d)["review_rows"].as_array().unwrap().len(), 1);
        assert_eq!(snapshot(&d)["review_rows"][0]["id"], "new");
        d.account_id = "b".into();
        assert_eq!(snapshot(&d)["review_rows"][0]["id"], "other");
        d.transactions[2].deleted = true;
        d.update_review_cycles();
        assert!(snapshot(&d)["review_rows"].as_array().unwrap().is_empty());
    }

    #[test]
    fn business_expenses_survive_encrypted_restart_and_archive_without_changing_transactions() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("business.vault");
        let mut vault =
            vault::Vault::create_native(path.clone(), &keystore::SyntheticKeyStore).unwrap();
        let mut data = Data::default();
        data.plan_id = "synthetic-plan".into();
        data.accounts.push(Account {
            id: "card".into(),
            name: "Synthetic card".into(),
            ..Default::default()
        });
        data.transactions.push(Transaction {
            id: "expense".into(),
            account_id: "card".into(),
            amount: -12345,
            date: "2026-09-08".into(),
            ..Default::default()
        });
        assert!(
            save_business_expense(&mut data, "missing", "Supplies".into(), "".into(), None)
                .is_err()
        );
        assert!(save_business_expense(&mut data, "expense", " ".into(), "".into(), None).is_err());
        save_business_expense(
            &mut data,
            "expense",
            "Synthetic supplies".into(),
            "Optional note".into(),
            None,
        )
        .unwrap();
        assert_eq!(data.business_expenses[0].amount, 12345);
        assert!(!data.transactions[0].approved);
        assert!(data.pending.is_empty());
        save_business_expense(&mut data, "expense", "Updated".into(), "".into(), None).unwrap();
        assert_eq!(data.business_expenses[0].description, "Updated");
        undo_business_expense(&mut data).unwrap();
        assert_eq!(data.business_expenses[0].description, "Synthetic supplies");
        archive_business_expenses(&mut data);
        archive_business_expenses(&mut data); // Empty archive must preserve undo.
        vault.commit(data).unwrap();
        drop(vault);
        assert!(
            !String::from_utf8_lossy(&std::fs::read(&path).unwrap()).contains("Synthetic supplies")
        );
        let mut reopened = vault::Vault::open_native(path, &keystore::SyntheticKeyStore).unwrap();
        assert!(reopened.data.business_expenses[0].archived);
        assert_eq!(reopened.data.business_expenses[0].note, "Optional note");
        assert!(matches!(
            reopened.data.business_undo.last(),
            Some(BusinessUndo::Archived { .. })
        ));
        undo_business_expense(&mut reopened.data).unwrap();
        assert!(!reopened.data.business_expenses[0].archived);
        let old: Data = serde_json::from_str("{}").unwrap();
        assert!(old.business_expenses.is_empty());
    }

    #[test]
    fn business_undo_handles_removal_readdition_and_legacy_archives() {
        let mut data = Data::default();
        data.business_expenses.push(BusinessExpense {
            plan_id: "synthetic-plan".into(),
            transaction_id: "synthetic-id".into(),
            archived: true,
            ..Default::default()
        });
        data.business_archive_undo = vec![0];
        remove_business_expense(&mut data, "synthetic-plan", "synthetic-id").unwrap();
        assert!(data.business_expenses.is_empty());
        undo_business_expense(&mut data).unwrap();
        assert!(data.business_expenses[0].archived);
        undo_business_expense(&mut data).unwrap();
        assert!(!data.business_expenses[0].archived);
        remember_business(
            &mut data,
            BusinessUndo::Added {
                plan_id: "synthetic-plan".into(),
                transaction_id: "synthetic-id".into(),
            },
        );
        undo_business_expense(&mut data).unwrap();
        assert!(data.business_expenses.is_empty());
        assert!(undo_business_expense(&mut data).is_err());
    }

    use super::*;
    use tower::ServiceExt;
    #[tokio::test]
    async fn blocks_foreign_origins_hosts_and_unauthenticated_reads() {
        let dir = tempfile::tempdir().unwrap();
        let app = Arc::new(Mutex::new(App {
            path: dir.path().join("test.vault"),
            legacy_path: None,
            keys: Arc::new(keystore::SyntheticKeyStore),
            session: None,
            ynab: ynab::Ynab::new(),
            last_unlock: None,
        }));
        let service = router(app, "http://127.0.0.1:12345".into(), dir.path().into());
        for (host, origin, marker, expected) in [
            ("evil.example:12345", "http://evil.example:12345", true, 403),
            ("127.0.0.1:12345", "http://evil.example", true, 403),
            ("127.0.0.1:12345", "http://127.0.0.1:12345", false, 403),
            ("127.0.0.1:12345", "http://127.0.0.1:12345", true, 401),
        ] {
            let mut request = Request::builder()
                .uri("/api/state")
                .header("host", host)
                .header("origin", origin);
            if marker {
                request = request.header("x-trilly", "1");
            }
            let result = service
                .clone()
                .oneshot(request.body(axum::body::Body::empty()).unwrap())
                .await
                .unwrap();
            assert_eq!(result.status().as_u16(), expected);
            assert_eq!(result.headers()["cache-control"], "no-store");
        }
    }
    #[tokio::test]
    async fn amazon_import_is_authenticated_plan_scoped_encrypted_and_does_not_change_review() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("amazon-synthetic.vault");
        let mut vault =
            vault::Vault::create_native(path.clone(), &keystore::SyntheticKeyStore).unwrap();
        let mut data = Data::default();
        data.plan_id = "synthetic-plan".into();
        data.account_id = "synthetic-card".into();
        data.transactions.push(Transaction {
            id: "synthetic-bank".into(),
            account_id: "synthetic-card".into(),
            amount: -10000,
            ..Default::default()
        });
        vault.commit(data).unwrap();
        let app = Arc::new(Mutex::new(App {
            path: path.clone(),
            legacy_path: None,
            keys: Arc::new(keystore::SyntheticKeyStore),
            session: Some(Session {
                bearer: Zeroizing::new("synthetic-session".into()),
                vault,
                active: Instant::now(),
            }),
            ynab: ynab::Ynab::new(),
            last_unlock: None,
        }));
        let service = router(
            app.clone(),
            "http://127.0.0.1:12345".into(),
            dir.path().into(),
        );
        let mut body = json!({"plan_id": "synthetic-plan", "completed_targets": ["synthetic-bank", "synthetic-bank", "unknown-id"], "payments": [], "orders": [{
            "id": "000-0000000-0000001", "marketplace": "amazon.ca", "url": "https://www.amazon.ca/gp/your-account/order-details?orderID=000-0000000-0000001",
            "date": "2026-09-01", "currency": "CAD", "total": 10000, "payment_method": "synthetic card", "fetched_at": "2026-09-02T00:00:00Z", "totals": [],
            "items": [{"id": "synthetic-item", "title": "synthetic-only-product", "quantity": 1, "unit_price": 10000, "price_text": "$10.00", "product_url": "https://www.amazon.ca/dp/SYNTHETIC", "image": format!("data:image/png;base64,{}", "A".repeat(40000)), "seller": "synthetic seller", "status": "Delivered", "details": ""}]
        }]});
        for (session, plan, expected) in [
            ("wrong", "synthetic-plan", 401),
            ("synthetic-session", "other-plan", 400),
            ("synthetic-session", "synthetic-plan", 200),
        ] {
            body["plan_id"] = json!(plan);
            let request = Request::builder()
                .method("POST")
                .uri("/api/amazon")
                .header("host", "127.0.0.1:12345")
                .header("origin", "http://127.0.0.1:12345")
                .header("x-trilly", "1")
                .header("x-session", session)
                .header("content-type", "application/json")
                .body(axum::body::Body::from(body.to_string()))
                .unwrap();
            let response = service.clone().oneshot(request).await.unwrap();
            assert_eq!(response.status().as_u16(), expected);
        }
        let locked = app.lock().await;
        let saved = &locked.session.as_ref().unwrap().vault.data;
        assert_eq!(saved.amazon.orders.len(), 1);
        assert_eq!(snapshot(saved)["queue"].as_array().unwrap().len(), 1);
        assert!(!saved.transactions[0].approved);
        assert!(saved.pending.is_empty());
        assert!(
            !String::from_utf8_lossy(&std::fs::read(&path).unwrap())
                .contains("synthetic-only-product")
        );
        let reopened = vault::Vault::open_native(path, &keystore::SyntheticKeyStore).unwrap();
        assert_eq!(
            reopened.data.amazon.orders[0].items[0].title,
            "synthetic-only-product"
        );
        assert_eq!(reopened.data.amazon_collected_targets, ["synthetic-bank"]);
        let mut reopened = reopened;
        let mut completed = reopened.data.clone();
        completed.transactions[0].approved = true;
        completed.transactions[0].memo = Some("reviewed description".into());
        completed.amazon_assignments.push(amazon::Assignment {
            payment_id: "synthetic-payment".into(),
            transaction_id: "synthetic-bank".into(),
        });
        assert!(amazon_review_finished(&completed));
        clear_amazon(&mut completed);
        reopened.commit(completed).unwrap();
        let cleaned =
            vault::Vault::open_native(reopened.path.clone(), &keystore::SyntheticKeyStore).unwrap();
        assert!(cleaned.data.amazon.orders.is_empty());
        assert!(cleaned.data.amazon.payments.is_empty());
        assert!(cleaned.data.amazon_assignments.is_empty());
        assert!(cleaned.data.amazon_collected_targets.is_empty());
        assert_eq!(
            cleaned.data.transactions[0].memo.as_deref(),
            Some("reviewed description")
        );
        drop(locked);
        {
            let mut locked = app.lock().await;
            let session = locked.session.as_mut().unwrap();
            session.vault.commit(cleaned.data.clone()).unwrap();
        }
        let request = Request::builder()
            .method("POST")
            .uri("/api/amazon")
            .header("host", "127.0.0.1:12345")
            .header("origin", "http://127.0.0.1:12345")
            .header("x-trilly", "1")
            .header("x-session", "synthetic-session")
            .header("content-type", "application/json")
            .body(axum::body::Body::from(body.to_string()))
            .unwrap();
        let response = service.oneshot(request).await.unwrap();
        assert_eq!(response.status().as_u16(), 200);
        let bytes = axum::body::to_bytes(response.into_body(), 1024)
            .await
            .unwrap();
        let response: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(response["retained"], false);
        let durable =
            vault::Vault::open_native(reopened.path.clone(), &keystore::SyntheticKeyStore).unwrap();
        assert!(durable.data.amazon.orders.is_empty());
        assert!(durable.data.amazon_collected_targets.is_empty());
    }

    #[test]
    fn collection_targets_exclude_queued_approvals_but_keep_conflicts_and_memo_edits() {
        let mut data = Data::default();
        let before = Transaction {
            id: "synthetic-target".into(),
            account_id: "other-account".into(),
            ..Default::default()
        };
        data.transactions.push(before.clone());
        let mut change = Change::from(&before);
        change.approved = true;
        data.pending.push(Pending {
            before,
            change,
            conflict: false,
        });
        assert!(
            snapshot(&data)["amazon_targets"]
                .as_array()
                .unwrap()
                .is_empty()
        );
        data.pending[0].conflict = true;
        assert_eq!(
            snapshot(&data)["amazon_targets"].as_array().unwrap().len(),
            1
        );
        data.pending[0].conflict = false;
        data.pending[0].change.memo_only = true;
        assert_eq!(
            snapshot(&data)["amazon_targets"].as_array().unwrap().len(),
            1
        );
    }

    #[test]
    fn amazon_cleanup_waits_for_the_whole_plan_and_confirmed_writes() {
        let mut data = Data::default();
        assert!(!amazon_review_finished(&data));
        data.plan_id = "synthetic-plan".into();
        data.account_id = "finished-account".into();
        data.transactions.push(Transaction {
            id: "other-account-transfer".into(),
            account_id: "other-account".into(),
            transfer_account_id: Some("finished-account".into()),
            ..Default::default()
        });
        assert!(!amazon_review_finished(&data));
        data.transactions[0].approved = true;
        let before = data.transactions[0].clone();
        data.pending.push(Pending {
            change: Change::from(&before),
            before,
            conflict: false,
        });
        assert!(!amazon_review_finished(&data));
        data.pending[0].conflict = true;
        assert!(!amazon_review_finished(&data));
        data.pending.clear();
        assert!(amazon_review_finished(&data));
        data.transactions[0].approved = false;
        data.transactions[0].deleted = true;
        assert!(amazon_review_finished(&data));
    }

    #[test]
    fn undo_retains_a_durable_reverse_for_ambiguous_network_outcomes() {
        let mut data = Data::default();
        let before = Transaction {
            id: "t".into(),
            ..Default::default()
        };
        let change = Change {
            payee_name: None,
            memo: None,
            memo_only: false,
            id: "t".into(),
            approved: true,
            payee_id: Some("p".into()),
            category_id: Some("c".into()),
        };
        let pending = Pending {
            before,
            change,
            conflict: false,
        };
        data.pending.push(pending.clone());
        data.undo.push(pending);
        undo(&mut data).unwrap();
        assert!(!data.pending[0].change.approved);
        assert!(data.pending[0].before.approved);
        assert!(data.undo.is_empty());
    }
}
