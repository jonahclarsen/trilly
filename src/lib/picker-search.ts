import type { Option } from './types.ts'

export function pickerResults(options: Option[], query: string, rankCategories = false, matchPayees = false): Option[] {
  const search = query.trim().toLowerCase()
  const words = search.split(/\s+/)
  const generalPayee = matchPayees && words.length > 2 ? words.slice(0, 2).join(' ') : null
  const matches = options.filter(o =>
    `${o.name} ${o.detail ?? ''}`.toLowerCase().includes(search) ||
    (generalPayee !== null && o.name.trim().toLowerCase().replace(/\s+/g, ' ') === generalPayee))
  if (rankCategories) {
    matches.sort((a, b) =>
      Number(b.name.toLowerCase().startsWith(search)) - Number(a.name.toLowerCase().startsWith(search)) ||
      (b.transactionCount ?? 0) - (a.transactionCount ?? 0) ||
      a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) ||
      (a.detail ?? '').localeCompare(b.detail ?? '', undefined, { sensitivity: 'base' }) ||
      a.id.localeCompare(b.id))
  }
  return matches.slice(0, 60)
}
