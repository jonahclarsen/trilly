import type { Option } from './types.ts'

export function pickerResults(options: Option[], query: string, rankCategories = false): Option[] {
  const search = query.trim().toLowerCase()
  const matches = options.filter(o => `${o.name} ${o.detail ?? ''}`.toLowerCase().includes(search))
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
