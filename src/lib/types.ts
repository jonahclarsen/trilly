export type BusinessExpense = { plan_id: string; transaction_id: string; description: string; date: string; amount: number; account: string; note: string; archived: boolean }
export type Option = { id: string; name: string; detail?: string }
export type Transaction = {
  id: string; account_id: string; date: string; amount: number; memo: string | null;
  approved: boolean; cleared: string; payee_id: string | null; payee_name: string | null;
  category_id: string | null; category_name: string | null;
  import_payee_name: string | null; import_payee_name_original: string | null;
  transfer_account_id: string | null; debt_transaction_type: string | null;
  subtransactions: { id: string; amount: number; category_id: string | null; memo: string | null; deleted: boolean }[];
}
export type Suggestion = { payee_id: string | null; category_id: string | null; payee: string; category: string; count: number; reason: string }
export type Snapshot = {
  business_expenses?: BusinessExpense[]; can_undo_archive?: boolean; can_undo_business?: boolean;
  description_pending?: string[];
  connected: boolean;
  plans: { id: string; name: string; currency_format: { iso_code: string } | null }[];
  plan_id: string; account_id: string; accounts: Option[];
  categories: { id: string; name: string; category_group_name: string }[];
  payees: Option[]; queue: Transaction[]; pending: number; conflicts: number;
  undo_transactions?: Transaction[];
  can_undo: boolean; synced_at: string | null; history_count: number; sync_error?: string;
}
export function special(t: Transaction) {
  return !!(t.subtransactions.length || t.transfer_account_id || t.debt_transaction_type || t.cleared === 'reconciled')
}
