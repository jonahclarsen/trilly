import type { BusinessExpense } from './types'

// Keep every value in one cell and prevent user text becoming a spreadsheet formula.
function cell(value: string) {
  const flat = value.replace(/[\t\r\n]+/g, ' ')
  return /^[\s]*[=+@-]/.test(flat) ? "'" + flat : flat
}
export function businessRows(expenses: BusinessExpense[]) {
  return expenses.map(e => [cell(e.description), e.date, String(e.amount / 1000), cell(e.account), cell(e.note)].join('\t')).join('\n')
}

export const expenseKey = (expense: Pick<BusinessExpense, 'expense_id' | 'transaction_id'>) => expense.expense_id || expense.transaction_id
export type BusinessExpenseInput = { expense_id: string; product_key: string; description: string; amount: number; note: string }
