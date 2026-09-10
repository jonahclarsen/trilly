use serde::{Deserialize, Serialize};
use zeroize::{Zeroize, ZeroizeOnDrop};

#[derive(Clone, Default, Serialize, Deserialize, Zeroize)]
pub struct Plan {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub currency_format: Option<Currency>,
}

#[derive(Clone, Serialize, Deserialize, Zeroize)]
pub struct Currency {
    pub iso_code: String,
}
impl Default for Currency {
    fn default() -> Self {
        Self {
            iso_code: "USD".into(),
        }
    }
}

#[derive(Clone, Default, Serialize, Deserialize, Zeroize)]
#[serde(default)]
pub struct Account {
    pub id: String,
    pub name: String,
    pub closed: bool,
    pub deleted: bool,
    pub transfer_payee_id: Option<String>,
}

#[derive(Clone, Default, Serialize, Deserialize, Zeroize)]
#[serde(default)]
pub struct Category {
    pub id: String,
    pub name: String,
    pub category_group_name: String,
    pub hidden: bool,
    pub deleted: bool,
}

#[derive(Clone, Default, Serialize, Deserialize, Zeroize)]
#[serde(default)]
pub struct Payee {
    pub id: String,
    pub name: String,
    pub transfer_account_id: Option<String>,
    pub deleted: bool,
}

#[derive(Clone, Default, Serialize, Deserialize, Zeroize, PartialEq)]
#[serde(default)]
pub struct Transaction {
    pub id: String,
    pub account_id: String,
    pub date: String,
    pub amount: i64,
    pub memo: Option<String>,
    pub approved: bool,
    pub cleared: String,
    pub payee_id: Option<String>,
    pub payee_name: Option<String>,
    pub category_id: Option<String>,
    pub category_name: Option<String>,
    pub import_payee_name: Option<String>,
    pub import_payee_name_original: Option<String>,
    pub transfer_account_id: Option<String>,
    pub debt_transaction_type: Option<String>,
    pub subtransactions: Vec<Split>,
    pub deleted: bool,
}

#[derive(Clone, Default, Serialize, Deserialize, Zeroize, PartialEq)]
#[serde(default)]
pub struct Split {
    pub id: String,
    pub amount: i64,
    pub payee_id: Option<String>,
    pub category_id: Option<String>,
    pub memo: Option<String>,
    pub deleted: bool,
}

impl Transaction {
    pub fn special(&self) -> bool {
        !self.subtransactions.is_empty()
            || self.transfer_account_id.is_some()
            || self.debt_transaction_type.is_some()
            || self.cleared == "reconciled"
    }
    pub fn matches_change(&self, change: &Change) -> bool {
        if change.memo_only {
            return self.memo.as_deref().unwrap_or("") == change.memo.as_deref().unwrap_or("");
        }
        self.approved == change.approved
            && self.payee_id == change.payee_id
            && self.category_id == change.category_id
    }
    pub fn same_editable_state(&self, other: &Self) -> bool {
        self.id == other.id
            && self.account_id == other.account_id
            && self.date == other.date
            && self.amount == other.amount
            && self.memo == other.memo
            && self.cleared == other.cleared
            && self.approved == other.approved
            && self.payee_id == other.payee_id
            && self.category_id == other.category_id
            && self.subtransactions == other.subtransactions
            && self.transfer_account_id == other.transfer_account_id
            && self.debt_transaction_type == other.debt_transaction_type
            && self.deleted == other.deleted
    }
}

#[derive(Clone, Serialize, Deserialize, Zeroize)]
pub struct Change {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub memo: Option<String>,
    #[serde(default)]
    pub memo_only: bool,
    pub id: String,
    pub payee_id: Option<String>,
    pub category_id: Option<String>,
    pub approved: bool,
}
impl From<&Transaction> for Change {
    fn from(t: &Transaction) -> Self {
        Self {
            memo: None,
            memo_only: false,
            id: t.id.clone(),
            payee_id: t.payee_id.clone(),
            category_id: t.category_id.clone(),
            approved: t.approved,
        }
    }
}

#[derive(Clone, Serialize, Deserialize, Zeroize)]
pub struct Pending {
    pub before: Transaction,
    pub change: Change,
    #[serde(default)]
    pub conflict: bool,
}

#[derive(Clone, Default, Serialize, Deserialize, Zeroize)]
pub struct BusinessExpense {
    pub plan_id: String,
    pub transaction_id: String,
    pub description: String,
    pub date: String,
    pub amount: i64,
    pub account: String,
    pub note: String,
    pub archived: bool,
}

#[derive(Clone, Serialize, Deserialize, Zeroize)]
pub enum BusinessUndo {
    Added {
        plan_id: String,
        transaction_id: String,
    },
    Removed {
        expense: BusinessExpense,
        index: usize,
    },
    Archived {
        keys: Vec<(String, String)>,
    },
}

#[derive(Clone, Default, Serialize, Deserialize, Zeroize, ZeroizeOnDrop)]
pub struct Data {
    #[serde(default)]
    pub business_undo: Vec<BusinessUndo>,
    #[serde(default)]
    pub business_expenses: Vec<BusinessExpense>,
    #[serde(default)]
    pub business_archive_undo: Vec<usize>,
    #[serde(default)]
    pub token: String,
    #[serde(default)]
    pub plans: Vec<Plan>,
    #[serde(default)]
    pub plan_id: String,
    #[serde(default)]
    pub account_id: String,
    #[serde(default)]
    pub accounts: Vec<Account>,
    #[serde(default)]
    pub categories: Vec<Category>,
    #[serde(default)]
    pub payees: Vec<Payee>,
    #[serde(default)]
    pub transactions: Vec<Transaction>,
    #[serde(default)]
    pub pending: Vec<Pending>,
    #[serde(default)]
    pub undo: Vec<Pending>,
    #[serde(default)]
    pub knowledge: i64,
    #[serde(default)]
    pub synced_at: Option<String>,
}
