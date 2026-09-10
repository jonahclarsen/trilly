import type { BusinessExpense } from './types'

// Keep every value in one cell and prevent user text becoming a spreadsheet formula.
function cell(value: string) {
  const flat = value.replace(/[\t\r\n]+/g, ' ')
  return /^[\s]*[=+@-]/.test(flat) ? "'" + flat : flat
}
export function businessRows(expenses: BusinessExpense[]) {
  return expenses.map(e => [cell(e.description), e.date, String(e.amount / 1000), cell(e.account), cell(e.note)].join('\t')).join('\n')
}
