mod keystore;
mod model;
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
    json!({"connected": !d.token.is_empty(), "plans": d.plans, "plan_id": d.plan_id,
        "account_id": d.account_id, "accounts": d.accounts.iter().filter(|a| !a.deleted && !a.closed).collect::<Vec<_>>(),
        "categories": d.categories.iter().filter(|c| !c.hidden && !c.deleted).collect::<Vec<_>>(),
        "payees": d.payees.iter().filter(|p| !p.deleted && p.transfer_account_id.is_none()).collect::<Vec<_>>(),
        "description_pending": d.pending.iter().filter(|p| p.change.memo_only).map(|p| &p.change.id).collect::<Vec<_>>(),
        "queue": queue, "pending": d.pending.len(), "conflicts": d.pending.iter().filter(|p| p.conflict).count(),
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

#[derive(Deserialize)]
#[serde(tag = "action", rename_all = "snake_case")]
enum Action {
    BusinessExpense {
        id: String,
        description: String,
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
        payee_id: Option<String>,
        category_id: Option<String>,
    },
    Undo,
    DiscardConflicts,
    Sync {
        #[serde(default)]
        full: bool,
    },
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
    let mut sync_error = None;
    match body {
        Action::Lock => unreachable!(),
        Action::BusinessExpense {
            id,
            description,
            note,
        } => add_business_expense(&mut next, &id, description, note)?,
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
            payee_id,
            category_id,
        } => {
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
            if t.special() && (t.payee_id != payee_id || t.category_id != category_id) {
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
                if !payee_id.as_ref().is_some_and(|id| {
                    next.payees
                        .iter()
                        .any(|p| p.id == *id && !p.deleted && p.transfer_account_id.is_none())
                }) {
                    return Err("Choose a payee".into());
                }
            }
            let pending = Pending {
                before: t.clone(),
                change: Change {
                    memo: None,
                    memo_only: false,
                    id,
                    payee_id,
                    category_id,
                    approved: true,
                },
                conflict: false,
            };
            next.pending.push(pending.clone());
            next.undo.push(pending);
            if next.undo.len() > 100 {
                next.undo.remove(0);
            }
        }
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
    app.session.as_mut().unwrap().vault.commit(next)?;
    let mut result = snapshot(&app.session.as_ref().unwrap().vault.data);
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

fn add_business_expense(
    data: &mut Data,
    id: &str,
    description: String,
    note: String,
) -> Result<()> {
    if description.trim().is_empty() {
        return Err("Description is required".into());
    }
    if description.len() > 10000 || note.len() > 10000 {
        return Err("Description or note is too long".into());
    }
    if data
        .business_expenses
        .iter()
        .any(|e| e.plan_id == data.plan_id && e.transaction_id == id)
    {
        return Err(
            "Transaction is already saved as a business expense (possibly archived)".into(),
        );
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
        plan_id: data.plan_id.clone(),
        transaction_id: id.into(),
        description: description.trim().into(),
        date: transaction.date.clone(),
        amount: transaction.amount.checked_neg().ok_or("Invalid amount")?,
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
            (e.plan_id.clone(), e.transaction_id.clone())
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
        .map(|e| (e.plan_id.clone(), e.transaction_id.clone()))
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
        .position(|e| e.plan_id == plan_id && e.transaction_id == id)
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
        BusinessUndo::Added {
            plan_id,
            transaction_id,
        } => {
            data.business_expenses
                .retain(|e| e.plan_id != plan_id || e.transaction_id != transaction_id);
        }
        BusinessUndo::Removed { expense, index } => {
            data.business_expenses
                .insert(index.min(data.business_expenses.len()), expense);
        }
        BusinessUndo::Archived { keys } => {
            for expense in &mut data.business_expenses {
                if keys
                    .iter()
                    .any(|(plan, id)| *plan == expense.plan_id && *id == expense.transaction_id)
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
    applied.category_id = previous.change.category_id.clone();
    let mut reverse = Change::from(&previous.before);
    if previous.change.memo_only {
        applied.memo = previous.change.memo.clone();
        reverse.memo = Some(previous.before.memo.clone().unwrap_or_default());
        reverse.memo_only = true;
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
        assert!(add_business_expense(&mut data, "missing", "Supplies".into(), "".into()).is_err());
        assert!(add_business_expense(&mut data, "expense", " ".into(), "".into()).is_err());
        add_business_expense(
            &mut data,
            "expense",
            "Synthetic supplies".into(),
            "Optional note".into(),
        )
        .unwrap();
        assert_eq!(data.business_expenses[0].amount, 12345);
        assert!(!data.transactions[0].approved);
        assert!(data.pending.is_empty());
        archive_business_expenses(&mut data);
        archive_business_expenses(&mut data); // Empty archive must preserve undo.
        assert!(add_business_expense(&mut data, "expense", "Duplicate".into(), "".into()).is_err());
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
    #[test]
    fn undo_retains_a_durable_reverse_for_ambiguous_network_outcomes() {
        let mut data = Data::default();
        let before = Transaction {
            id: "t".into(),
            ..Default::default()
        };
        let change = Change {
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
