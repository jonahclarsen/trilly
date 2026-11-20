export type WealthsimpleRow = { date: string; payee: string; memo: string; amount: number }

export function parseWealthsimple(text: string, now = new Date()): WealthsimpleRow[] {
  let lines = text.trim().split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  const start = lines.indexOf('Scheduled activities')
  if (start >= 0) lines = lines.slice(start + 1)
  const end = lines.indexOf('Load more')
  if (end >= 0) lines = lines.slice(0, end)

  const rows: WealthsimpleRow[] = []
  let date = ''
  let fields: string[] = []
  const inactive = new Set(['Cancelled', 'Canceled', 'Expired', 'Pending', 'Scheduled', 'Failed', 'Declined'])
  for (const [index, line] of lines.entries()) {
    const heading = line.replace(/^"|"$/g, '')
    if (/^(Today|Yesterday)$/.test(heading) || /^(January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, \d{4}$/.test(heading)) {
      if (date && fields.length) throw new Error('Copy complete transactions from Wealthsimple Activity.')
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
    if (!date || line === 'Chequing' || inactive.has(line)) continue

    const money = /^([+\-−]?)\s*\$\s*([+\-−]?)((?:\d{1,3}(?:,\d{3})+|\d+))(?:\.(\d{2}))?\s*CAD$/.exec(line)
    if (!money) {
      if (/\$.*\b[A-Z]{3}$/.test(line)) throw new Error('Only CAD transaction amounts are supported.')
      fields.push(line)
      continue
    }
    const [, prefix, inner, dollars = '', cents = '00'] = money
    if ((prefix && inner) || !fields.length) throw new Error('Invalid transaction row.')
    const sign = prefix || inner
    const amount = (Number(dollars.replaceAll(',', '')) * 1000 + Number(cents) * 10) * (/[-−]/.test(sign) ? -1 : 1)
    if (!Number.isSafeInteger(amount) || Math.abs(amount) > 999_999_999_990) throw new Error('Invalid transaction amount.')
    const memo = fields.length > 1 ? fields.pop()! : ''
    const payee = fields.join(' - ')
    if (!inactive.has(lines[index + 1] ?? '')) rows.push({ date, payee, memo, amount })
    fields = []
  }

  if (fields.length) throw new Error('Copy complete transactions from Wealthsimple Activity.')
  if (!rows.length) throw new Error('No completed Wealthsimple transactions found.')
  if (rows.length > 500) throw new Error('Paste up to 500 transactions at a time.')
  return rows
}
