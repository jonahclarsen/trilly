export type WealthsimpleRow = { date: string; payee: string; memo: string; amount: number }

export type WealthsimplePreview = { rows?: WealthsimpleRow[]; skipped?: string[][]; error?: string }

export function parseWealthsimple(text: string, now = new Date()): WealthsimplePreview {
  let lines = text.split(/\r?\n/).map(raw => ({ raw, text: raw.trim() })).filter(line => line.text)
  const start = lines.findIndex(line => line.text === 'Scheduled activities')
  if (start >= 0) lines = lines.slice(start + 1)
  const end = lines.findIndex(line => line.text === 'Load more')
  if (end >= 0) lines = lines.slice(0, end)

  const rows: WealthsimpleRow[] = []
  const skipped: string[][] = []
  let date = ''
  let fields: string[] = []
  const inactive = new Set(['Cancelled', 'Canceled', 'Expired', 'Pending', 'Scheduled', 'Failed', 'Declined'])
  for (const [index, { raw, text: line }] of lines.entries()) {
    const heading = line.replace(/^"|"$/g, '')
    if (/^(Today|Yesterday)$/.test(heading) || /^(January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, \d{4}$/.test(heading)) {
      if (fields.length) skipped.push(fields)
      const day = new Date(now)
      if (heading === 'Yesterday') day.setDate(day.getDate() - 1)
      const parsed = heading === 'Today' || heading === 'Yesterday' ? day : new Date(heading)
      const explicitDay = / (\d{1,2}),/.exec(heading)?.[1]
      if (!Number.isFinite(parsed.getTime()) || (explicitDay && parsed.getDate() !== Number(explicitDay))) {
        throw new Error('Invalid transaction date.')
      }
      date = [parsed.getFullYear(), String(parsed.getMonth() + 1).padStart(2, '0'), String(parsed.getDate()).padStart(2, '0')].join('-')
      fields = []
      continue
    }
    if (line === 'Chequing' || inactive.has(line)) continue
    if (!date) {
      fields.push(raw)
      continue
    }

    const money = /^([+\-−]?)\s*\$\s*([+\-−]?)((?:\d{1,3}(?:,\d{3})+|\d+))(?:\.(\d{2}))?\s*CAD$/.exec(line)
    if (!money) {
      if (/\$.*\b[A-Z]{3}$/.test(line)) throw new Error('Only CAD transaction amounts are supported.')
      fields.push(raw)
      continue
    }
    const [, prefix, inner, dollars = '', cents = '00'] = money
    if ((prefix && inner) || !fields.length) throw new Error('Invalid transaction row.')
    const sign = prefix || inner
    const amount = (Number(dollars.replaceAll(',', '')) * 1000 + Number(cents) * 10) * (/[-−]/.test(sign) ? -1 : 1)
    if (!Number.isSafeInteger(amount) || Math.abs(amount) > 999_999_999_990) throw new Error('Invalid transaction amount.')
    const names = fields.map(field => field.trim())
    const memo = names.length > 1 ? names.pop()! : ''
    const payee = names.join(' - ')
    if (!inactive.has(lines[index + 1]?.text ?? '')) rows.push({ date, payee, memo, amount })
    fields = []
  }

  if (fields.length) skipped.push(fields)
  if (!rows.length) return { skipped, error: 'No complete transactions found. Include the date, payee, and CAD amount.' }
  if (rows.length > 500) throw new Error('Paste up to 500 transactions at a time.')
  return { rows, skipped }
}
