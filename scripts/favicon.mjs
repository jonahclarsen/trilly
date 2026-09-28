import sharp from 'sharp'

const maxBytes = 512 * 1024
const maxIconBytes = 64 * 1024
const headers = { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Safari/537.36', Accept: 'text/html,image/*;q=0.9,*/*;q=0.8' }

// Accepts a page or image URL (scheme optional) and a %s template placeholder.
export function iconSourceUrl(source) {
  const text = String(source).trim().replaceAll('%s', '')
  const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(text) ? text : `https://${text}`)
  if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) throw new Error('Icon sources must be HTTPS URLs without credentials.')
  return url
}

async function download(url) {
  const response = await fetch(url, { headers, redirect: 'follow', signal: AbortSignal.timeout(8000) })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (bytes.length > maxBytes) throw new Error('Too large.')
  return { url: new URL(response.url || url), type: (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase(), bytes }
}

const attribute = (tag, name) => new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag)?.slice(1).find(v => v !== undefined)

// Prefer declared icons nearest 64px, then the conventional /favicon.ico.
export function iconCandidates(html, base) {
  const links = [...html.matchAll(/<link\b[^>]*>/gi)].map(([tag]) => ({ rel: attribute(tag, 'rel')?.toLowerCase() ?? '', href: attribute(tag, 'href'), sizes: attribute(tag, 'sizes') ?? '', type: attribute(tag, 'type') ?? '' }))
    .filter(link => link.href && /(^|\s)(icon|apple-touch-icon)(\s|$)/.test(link.rel) && !/mask-icon/.test(link.rel))
  const score = link => {
    if (link.type.includes('svg') || /\.svg(\?|$)/i.test(link.href) || link.sizes === 'any') return 0
    const size = Math.max(0, ...link.sizes.split(/\s+/).map(s => Number(s.split('x')[0]) || 0))
    return size ? Math.abs(Math.log2(size / 64)) : link.rel.includes('apple') ? 1.5 : 1
  }
  const urls = links.sort((a, b) => score(a) - score(b)).flatMap(link => { try { return [new URL(link.href.replaceAll('&amp;', '&'), base).href] } catch { return [] } })
  return [...new Set([...urls, new URL('/favicon.ico', base).href])]
}

// Keep one ICO frame near 64px: embedded PNG frames resize, bitmap frames stay ICO.
function icoFrame(bytes) {
  if (bytes.length < 6 || bytes.readUInt16LE(0) !== 0 || bytes.readUInt16LE(2) !== 1) return null
  const entries = Array.from({ length: bytes.readUInt16LE(4) }, (_, i) => {
    const at = 6 + i * 16
    return at + 16 > bytes.length ? null : { entry: bytes.subarray(at, at + 16), size: bytes[at] || 256, length: bytes.readUInt32LE(at + 8), offset: bytes.readUInt32LE(at + 12) }
  }).filter(frame => frame && frame.offset + frame.length <= bytes.length)
  const frame = entries.sort((a, b) => Math.abs(Math.log2(a.size / 64)) - Math.abs(Math.log2(b.size / 64)) || b.size - a.size)[0]
  if (!frame) return null
  const data = bytes.subarray(frame.offset, frame.offset + frame.length)
  if (data.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) return { png: data }
  // 32-bit bitmap frames are bottom-up BGRA; convert them to raw RGBA for sharp.
  if (data.length >= 40 && data.readUInt32LE(0) === 40 && data.readUInt16LE(14) === 32) {
    const width = data.readInt32LE(4), height = data.readInt32LE(8) / 2
    if (width > 0 && height > 0 && data.length >= 40 + width * height * 4) {
      const rgba = Buffer.alloc(width * height * 4)
      for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const from = 40 + ((height - 1 - y) * width + x) * 4, to = (y * width + x) * 4
        rgba[to] = data[from + 2]; rgba[to + 1] = data[from + 1]; rgba[to + 2] = data[from]; rgba[to + 3] = data[from + 3]
      }
      return { raw: { rgba, width, height } }
    }
  }
  const header = Buffer.alloc(22)
  header.writeUInt16LE(1, 2); header.writeUInt16LE(1, 4)
  frame.entry.copy(header, 6); header.writeUInt32LE(22, 18)
  return { ico: Buffer.concat([header, data]) }
}

async function toDataUri({ type, bytes }) {
  const frame = icoFrame(bytes)
  if (frame?.png) bytes = frame.png
  else if (frame?.raw) {
    const { rgba, width, height } = frame.raw
    const png = await sharp(rgba, { raw: { width, height, channels: 4 } }).resize(64, 64, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()
    return `data:image/png;base64,${png.toString('base64')}`
  }
  else if (frame?.ico) {
    if (frame.ico.length > maxIconBytes) throw new Error('Unsupported icon.')
    return `data:image/x-icon;base64,${frame.ico.toString('base64')}`
  }
  try {
    const png = await sharp(bytes, { density: 192 }).resize(64, 64, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer()
    return `data:image/png;base64,${png.toString('base64')}`
  } catch {
    // Sharp cannot decode .ico; keep small originals as-is.
    const mime = /icon|ico/.test(type) || (bytes[0] === 0 && bytes[2] === 1) ? 'image/x-icon' : type
    if (!/^image\/(x-icon|vnd\.microsoft\.icon|png|gif|jpeg|webp|svg\+xml)$/.test(mime) || bytes.length > maxIconBytes) throw new Error('Unsupported icon.')
    return `data:${mime};base64,${bytes.toString('base64')}`
  }
}

// Fetches a page's favicon (or an image URL directly) and embeds it as a data URI.
export async function fetchFavicon(source) {
  const first = await download(iconSourceUrl(source))
  if (first.type.startsWith('image/')) return toDataUri(first)
  const candidates = iconCandidates(first.type.includes('html') ? first.bytes.toString('utf8') : '', first.url)
  for (const candidate of candidates) {
    try {
      const icon = await download(candidate)
      if (icon.type.startsWith('image/') || candidate.endsWith('.ico')) return await toDataUri(icon)
    } catch { /* Try the next candidate. */ }
  }
  throw new Error('No icon found.')
}

export const iconPattern = /^data:image\/(png|x-icon|vnd\.microsoft\.icon|gif|jpeg|webp|svg\+xml);base64,[A-Za-z\d+/]+=*$/
