import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type {
  ChatRecord,
  Chats,
  Days,
  Live,
  Remote,
  Stats,
  SyncRecord,
} from '../types'

const EMPTY: Live = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  turns: 0,
  usd: 0,
  contextPct: 0,
  limits: [],
}

const live = atom({ plugin: 'usage-meter', key: 'live' } as const, EMPTY, {
  shape: 'live-1',
})
const chatsAtom = atom({ plugin: 'usage-meter', key: 'chats' } as const, {}, {
  shape: 'chats-1',
})
const daysAtom = atom({ plugin: 'usage-meter', key: 'days' } as const, {}, {
  shape: 'days-1',
})
// The chat's first message, its name: kept in session state so a reload keeps it.
const firstPrompt = atom({ plugin: 'usage-meter', key: 'firstPrompt' } as const, '')
const isHidden = atom({ plugin: 'usage-meter', key: 'isHidden' } as const, false)
// This chat's tokens per day: what it syncs.
const chatDays = atom({ plugin: 'usage-meter', key: 'chatDays' } as const, {}, {
  shape: 'chat-days-1',
})
// Every chat's numbers, read from Google Drive.
const remote = atom({ plugin: 'usage-meter', key: 'remote' } as const, null, {
  shape: 'remote-1',
})
const syncState = atom({ plugin: 'usage-meter', key: 'syncState' } as const, 'local')

const PANE = 'usage-meter'
const CHATS = 'chats-v1'
const DAYS = 'days-v1'
const HIDDEN = 'hidden-v1'
const MAX_CHATS = 200
const MAX_DAYS = 400
const DAY_MS = 86400000

// Google Drive sync: one small file per chat in one folder; the chat's numbers
// are the file's description, so a single search reads every chat back.
const DRIVE_SERVERS = ['Google Drive', 'claude.ai Google Drive']
const DRIVE_SERVER = 'drive-server-v1'
const DRIVE_FILES = 'drive-files-v1'
const FOLDER_TITLE = 'Claude usage-meter'
const FOLDER_MIME = 'application/vnd.google-apps.folder'
const READ_EVERY_MS = 5 * 60 * 1000

// Palette: reads on light and dark backgrounds alike.
const ACCENT = '#d97757'
const LEVELS = ['#8b8b8b33', '#d977574d', '#d9775780', '#d97757bf', '#d97757']
const INK = '#8b8b8b'
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// ── helpers ──────────────────────────────────────────────────────────────
const fmt = (n: number): string =>
  n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : `${n}`

const commas = (n: number): string =>
  String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ',')

const total = (l: Live): number => l.input + l.output + l.cacheRead + l.cacheWrite

const limitName = (kind: string): string =>
  kind === 'five_hour' ? '5h limit' : kind === 'seven_day' ? 'weekly limit' : kind

const pad2 = (n: number): string => (n < 10 ? `0${n}` : `${n}`)

const dayKey = (ms: number): string => {
  const d = new Date(ms)

  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`
}

const prettyDay = (ms: number): string => {
  const d = new Date(ms)

  return `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
}

const esc = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const topChats = (chats: Chats, n: number): ChatRecord[] =>
  Object.values(chats)
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, n)

/** Level 0–4 for a day's tokens, scaled against the busiest day shown. */
const levelOf = (tokens: number, max: number): number => {
  if (tokens <= 0 || max <= 0) return 0
  const r = tokens / max

  return r > 0.75 ? 4 : r > 0.5 ? 3 : r > 0.25 ? 2 : 1
}

type Cell = { key: string; ms: number; tokens: number; chats: number; level: number }

const cellOf = (days: Stats, ms: number): Cell => {
  const key = dayKey(ms)
  const d = days[key]

  return { key, ms, tokens: d?.tokens ?? 0, chats: d?.chats ?? 0, level: 0 }
}

const leveled = (cells: Cell[]): void => {
  const max = cells.reduce((m, c) => Math.max(m, c.tokens), 0)
  for (const c of cells) c.level = levelOf(c.tokens, max)
}

/** The calendar: `weeks` columns of Sunday→Saturday, ending with today's week. */
function calendar(days: Stats, now: number, weeks: number): Cell[][] {
  const start = now - (new Date(now).getDay() + 7 * (weeks - 1)) * DAY_MS
  const cols: Cell[][] = []
  for (let w = 0; w < weeks; w++) {
    const col: Cell[] = []
    for (let d = 0; d < 7; d++) {
      const ms = start + (w * 7 + d) * DAY_MS
      if (ms > now) break
      col.push(cellOf(days, ms))
    }
    cols.push(col)
  }
  leveled(cols.flat())

  return cols
}

/** The last `n` days, oldest first. */
function lastDays(days: Stats, now: number, n: number): Cell[] {
  const cells: Cell[] = []
  for (let i = n - 1; i >= 0; i--) cells.push(cellOf(days, now - i * DAY_MS))
  leveled(cells)

  return cells
}

const tipFor = (c: Cell): string =>
  c.tokens > 0
    ? `${prettyDay(c.ms)} · ${commas(c.tokens)} tokens · ${c.chats} chat${c.chats === 1 ? '' : 's'}`
    : `${prettyDay(c.ms)} · no usage`

/** Full calendar as SVG, with a hover tooltip on every square. */
function calendarSvg(cols: Cell[][]): string {
  const S = 11
  const G = 3
  const LEFT = 30
  const TOP = 16
  const w = LEFT + cols.length * (S + G) + 4
  const h = TOP + 7 * (S + G) + 22
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif" font-size="9">`,
    `<style>rect.d:hover{stroke:${INK};stroke-width:1.5}</style>`,
  ]
  // Month labels where a month starts; drop one a following label would crowd.
  const labels: { x: number; m: number }[] = []
  cols.forEach((col, x) => {
    const first = col[0]
    if (!first) return
    const m = new Date(first.ms).getMonth()
    if (labels.length === 0 || labels[labels.length - 1]!.m !== m) labels.push({ x, m })
  })
  labels
    .filter((l, i) => (labels[i + 1]?.x ?? Infinity) - l.x >= 3)
    .forEach(l =>
      parts.push(`<text x="${LEFT + l.x * (S + G)}" y="10" fill="${INK}">${MONTHS[l.m]}</text>`),
    )
  cols.forEach((col, x) => {
    col.forEach((c, y) => {
      parts.push(
        `<rect class="d" x="${LEFT + x * (S + G)}" y="${TOP + y * (S + G)}" width="${S}" height="${S}" rx="2" fill="${LEVELS[c.level]}"><title>${esc(tipFor(c))}</title></rect>`,
      )
    })
  })
  for (const [row, label] of [
    [1, 'Mon'],
    [3, 'Wed'],
    [5, 'Fri'],
  ] as const) {
    parts.push(`<text x="0" y="${TOP + row * (S + G) + 9}" fill="${INK}">${label}</text>`)
  }
  const ly = TOP + 7 * (S + G) + 8
  const lx = w - 5 * (S + G) - 30
  parts.push(`<text x="${lx - 24}" y="${ly + 9}" fill="${INK}">Less</text>`)
  LEVELS.forEach((c, i) =>
    parts.push(
      `<rect x="${lx + i * (S + G)}" y="${ly}" width="${S}" height="${S}" rx="2" fill="${c}"/>`,
    ),
  )
  parts.push(`<text x="${lx + 5 * (S + G) + 2}" y="${ly + 9}" fill="${INK}">More</text>`)
  parts.push('</svg>')

  return parts.join('')
}

/** A one-row strip of squares for the band above the prompt. */
function stripSvg(cells: Cell[]): string {
  const S = 12
  const G = 3
  const w = cells.length * (S + G)
  const body = cells
    .map(
      (c, i) =>
        `<rect class="d" x="${i * (S + G)}" y="1" width="${S}" height="${S}" rx="2.5" fill="${LEVELS[c.level]}"><title>${esc(tipFor(c))}</title></rect>`,
    )
    .join('')

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${S + 2}" viewBox="0 0 ${w} ${S + 2}"><style>rect.d:hover{stroke:${INK};stroke-width:1.5}</style>${body}</svg>`
}

/**
 * Tokens per day across every chat: Drive's records (this chat's live numbers
 * in place of its synced ones), and this machine's own days where they are more.
 */
function statsOf(local: Days, rem: Remote | null, id: string, mine: Record<string, number>): Stats {
  const out: Stats = {}
  if (rem) {
    for (const [cid, rec] of Object.entries(rem.records)) {
      const days = cid === id ? mine : rec.days
      for (const [day, tokens] of Object.entries(days)) {
        if (!(tokens > 0)) continue
        const d = out[day] ?? { tokens: 0, chats: 0 }
        out[day] = { tokens: d.tokens + tokens, chats: d.chats + 1 }
      }
    }
    if (!rem.records[id]) {
      for (const [day, tokens] of Object.entries(mine)) {
        if (!(tokens > 0)) continue
        const d = out[day] ?? { tokens: 0, chats: 0 }
        out[day] = { tokens: d.tokens + tokens, chats: d.chats + 1 }
      }
    }
  }
  for (const [day, d] of Object.entries(local)) {
    const o = out[day]
    if (!o || d.tokens > o.tokens) out[day] = { tokens: d.tokens, chats: d.chats.length }
  }

  return out
}

/** Every chat known here or on Drive, the newer copy of each. */
function chatsOf(local: Chats, rem: Remote | null): Chats {
  const out: Chats = { ...local }
  for (const [id, r] of Object.entries(rem?.records ?? {})) {
    const have = out[id]
    if (!have || r.updatedAt > have.updatedAt) {
      out[id] = { id, title: r.title, tokens: r.tokens, usd: r.usd, turns: r.turns, updatedAt: r.updatedAt }
    }
  }

  return out
}

const textOf = (blocks: readonly { type: string; text?: string }[]): string =>
  blocks.map(b => (b.type === 'text' && typeof b.text === 'string' ? b.text : '')).join('')

type DriveFile = { id?: string; title?: string; description?: string; parentId?: string }
type DriveAnswer = { id?: string; files?: DriveFile[]; nextPageToken?: string }

/** Calls a Google Drive connector tool, on whichever Drive server this host has. */
async function drive($: EngineInterface, tool: string, args: Record<string, unknown>): Promise<DriveAnswer> {
  const known = await $.store.get(DRIVE_SERVER)
  const order =
    typeof known === 'string' ? [known, ...DRIVE_SERVERS.filter(s => s !== known)] : DRIVE_SERVERS
  let failure: unknown = new Error('Google Drive is not connected')
  for (const server of order) {
    try {
      const r = await $.mcp.call(server, tool, args)
      const text = textOf(r.content as { type: string; text?: string }[])
      if (r.isError) throw new Error(text.slice(0, 200) || `${tool} failed`)
      if (server !== known) await $.store.set(DRIVE_SERVER, server)

      return text ? (JSON.parse(text) as DriveAnswer) : {}
    } catch (err) {
      failure = err
    }
  }
  throw failure
}

const quote = (s: string): string => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")

/** Every 'Claude usage-meter' folder (two chats may each have made one). */
async function folders($: EngineInterface): Promise<string[]> {
  const r = await drive($, 'search_files', {
    query: `title = '${FOLDER_TITLE}' and mimeType = '${FOLDER_MIME}' and trashed = false`,
    excludeContentSnippets: true,
    pageSize: 10,
  })

  return (r.files ?? []).map(f => f.id).filter((x): x is string => !!x).sort()
}

/** This chat's file on Drive, made on first use. */
async function chatFile($: EngineInterface, id: string): Promise<string> {
  const cached = (await $.store.get(DRIVE_FILES)) as Record<string, string> | undefined
  const files = cached && typeof cached === 'object' ? { ...cached } : {}
  const hit = files[id]
  if (hit) return hit
  const title = `usage-meter chat ${id}`
  const found = await drive($, 'search_files', {
    query: `title = '${quote(title)}' and trashed = false`,
    excludeContentSnippets: true,
    pageSize: 1,
  })
  let fileId = found.files?.[0]?.id
  if (!fileId) {
    let folder = (await folders($))[0]
    if (!folder) {
      folder = (await drive($, 'create_file', { title: FOLDER_TITLE, contentMimeType: FOLDER_MIME })).id
    }
    const made = await drive($, 'create_file', {
      title,
      ...(folder ? { parentId: folder } : {}),
      textContent: 'usage-meter keeps this chat\'s token counts in this file\'s description.',
      contentMimeType: 'text/plain',
      disableConversionToGoogleType: true,
    })
    fileId = made.id
  }
  if (!fileId) throw new Error('Drive made no file')
  files[id] = fileId
  const ids = Object.keys(files)
  for (const old of ids.slice(0, Math.max(0, ids.length - MAX_CHATS))) delete files[old]
  await $.store.set(DRIVE_FILES, files)

  return fileId
}

/** Reads every chat's record from Drive into `remote`. */
async function pull($: EngineInterface, now: number): Promise<void> {
  const parents = await folders($)
  const records: Record<string, SyncRecord> = {}
  if (parents.length > 0) {
    const inAny = parents.map(f => `parentId = '${quote(f)}'`).join(' or ')
    let pageToken: string | undefined
    for (let page = 0; page < 10; page++) {
      const r = await drive($, 'search_files', {
        query: `(${inAny}) and trashed = false`,
        excludeContentSnippets: true,
        pageSize: 100,
        ...(pageToken ? { pageToken } : {}),
      })
      for (const f of r.files ?? []) {
        const cid = f.title?.startsWith('usage-meter chat ') ? f.title.slice(17) : ''
        if (!cid || !f.description) continue
        try {
          const rec = JSON.parse(f.description) as SyncRecord
          if (rec && rec.v === 1 && typeof rec.tokens === 'number' && rec.days) records[cid] = rec
        } catch {
          // Not one of ours, or cut short: skip it.
        }
      }
      pageToken = r.nextPageToken
      if (!pageToken) break
    }
  }
  await update($, remote, () => ({ records, syncedAt: now }))
}

/** Writes this chat's record to Drive, and reads everyone's when due. */
async function push($: EngineInterface, id: string, rec: SyncRecord, now: number): Promise<void> {
  const description = JSON.stringify(rec)
  let fileId = await chatFile($, id)
  try {
    await drive($, 'update_file', { fileId, description })
  } catch {
    // The file may have been trashed: forget it and make a new one, once.
    const cached = ((await $.store.get(DRIVE_FILES)) ?? {}) as Record<string, string>
    const { [id]: _gone, ...rest } = cached
    await $.store.set(DRIVE_FILES, rest)
    fileId = await chatFile($, id)
    await drive($, 'update_file', { fileId, description })
  }
  const rem = await read($, remote)
  if (!rem || now - rem.syncedAt >= READ_EVERY_MS) {
    await pull($, now)
  } else {
    await update($, remote, r => (r ? { ...r, records: { ...r.records, [id]: rec } } : r))
  }
}

function tips(l: Live, chats: Chats): string[] {
  const out: string[] = []
  const t = total(l)
  const inputSide = l.input + l.cacheRead + l.cacheWrite

  if (l.contextPct >= 60) {
    out.push(
      `Context is ${l.contextPct}% full: run /compact (or /clear if you're switching topics). Every message re-sends the whole context.`,
    )
  }
  if (l.turns >= 30) {
    out.push(
      `This chat has ${l.turns} turns. Long chats get expensive per message; start a fresh chat for each new task.`,
    )
  }
  if (inputSide > 0 && l.cacheRead / inputSide < 0.5 && l.turns >= 3) {
    out.push(
      'Low cache reuse: avoid long pauses mid-task and avoid switching models mid-chat, both invalidate the prompt cache.',
    )
  }
  if (t > 0 && l.output / t > 0.15) {
    out.push(
      'A lot of output tokens: ask for diffs or short answers instead of whole files, and lower effort for simple tasks.',
    )
  }
  for (const lim of l.limits) {
    if (lim.percentUsed >= 70) {
      out.push(
        `${limitName(lim.kind)} is at ${lim.percentUsed}%: use a smaller model (/model) for routine work to stretch it.`,
      )
    }
  }
  const big = topChats(chats, 1)[0]
  if (big && big.tokens > 5e6) {
    out.push(
      `Your heaviest chat ("${big.title}") used ${fmt(big.tokens)} tokens. Splitting work like that into smaller chats usually costs far less.`,
    )
  }
  out.push(
    'Point Claude at specific files and lines instead of "look around the repo", keep CLAUDE.md short, and turn off MCP servers and plugins you don\'t use (their tool lists load into every request).',
  )

  return out
}

async function loadChats($: EngineInterface): Promise<Chats> {
  const raw = await $.store.get(CHATS)

  return raw && typeof raw === 'object' ? (raw as Chats) : {}
}

async function loadDays($: EngineInterface): Promise<Days> {
  const raw = await $.store.get(DAYS)

  return raw && typeof raw === 'object' ? (raw as Days) : {}
}

async function refresh($: EngineInterface): Promise<void> {
  const u = await $.session.usage()
  await update($, live, l => ({
    ...l,
    usd: u.cost?.usd ?? l.usd,
    contextPct: u.context.percent ?? l.contextPct,
    limits: u.rateLimits.map(r => ({ kind: r.kind, percentUsed: r.percentUsed })),
  }))
}

/** Hide or show the full bar, here and in chats started after. */
async function setHidden($: EngineInterface, hidden: boolean): Promise<void> {
  await update($, isHidden, () => hidden)
  await $.store.set(HIDDEN, hidden)
}

async function openPane($: EngineInterface): Promise<void> {
  await $.ui.open({ id: PANE, title: 'Usage' })
}

function syncNote(state: string, rem: Remote | null): string {
  if (state === 'synced' && rem) {
    const n = Object.keys(rem.records).length
    return `Synced with Google Drive: ${n} chat${n === 1 ? '' : 's'} across your machines and cloud chats`
  }
  if (state === 'off') return 'This machine only (Drive sync is turned off)'

  return 'This machine only: connect Google Drive to Claude to include every chat'
}

async function report($: EngineInterface): Promise<string> {
  await refresh($)
  const l = await read($, live)
  const rem = await read($, remote)
  const id = await $.session.id()
  const chats = chatsOf(await read($, chatsAtom), rem)
  const days = statsOf(await read($, daysAtom), rem, id, await read($, chatDays))
  const sync = await read($, syncState)
  const now = await $.clock.now()
  const week = lastDays(days, now, 7).reduce((n, c) => n + c.tokens, 0)
  const lines: string[] = []
  lines.push('── Usage meter ──')
  lines.push(
    `This chat: ${fmt(total(l))} tokens over ${l.turns} turns (~$${l.usd.toFixed(2)} est., not your bill)`,
  )
  lines.push(
    `  input ${fmt(l.input)} · cache read ${fmt(l.cacheRead)} · cache write ${fmt(l.cacheWrite)} · output ${fmt(l.output)}`,
  )
  lines.push(`  context window ${l.contextPct}% full`)
  for (const lim of l.limits) lines.push(`  ${limitName(lim.kind)}: ${lim.percentUsed}% used`)
  lines.push(`Today: ${fmt(days[dayKey(now)]?.tokens ?? 0)} tokens · last 7 days: ${fmt(week)}`)
  lines.push(`  ${syncNote(sync, rem)}`)
  const ranked = topChats(chats, 5)
  if (ranked.length > 0) {
    lines.push('')
    lines.push('Chats using the most tokens:')
    ranked.forEach((c, i) =>
      lines.push(`  ${i + 1}. ${fmt(c.tokens)}  ${c.title}  (${c.turns} turns)`),
    )
  }
  lines.push('')
  lines.push('Ways to cut usage:')
  for (const t of tips(l, chats)) lines.push(`  • ${t}`)
  lines.push('')
  lines.push('The Usage panel has your daily calendar: hover a square to see that day.')

  return lines.join('\n')
}

export const register: Register = (on, options) => {
  const isSyncOn = options.driveSync !== false

  on('session.start', async ($, e, next) => {
    const r = await next(e)
    await $.command.register({
      name: 'usage-tips',
      description: 'Token usage calendar, your heaviest chats, and tips to use fewer tokens',
    })
    const chats = await loadChats($)
    const days = await loadDays($)
    await update($, chatsAtom, () => chats)
    await update($, daysAtom, () => days)
    const hidden = await $.store.get(HIDDEN)
    await update($, isHidden, () => hidden === true)
    await refresh($)
    if (!isSyncOn) {
      await update($, syncState, () => 'off' as const)
    } else {
      try {
        await pull($, await $.clock.now())
        await update($, syncState, () => 'synced' as const)
        // A resumed chat picks up its own days where this machine forgot them.
        const own = (await read($, remote))?.records[await $.session.id()]
        if (own) await update($, chatDays, d => (Object.keys(d).length > 0 ? d : own.days))
      } catch {
        await update($, syncState, () => 'local' as const)
      }
    }

    return r
  })

  on('prompt.submit', async ($, e, next) => {
    const t = e.text.trim()
    if (t && !t.startsWith('/') && !(await read($, firstPrompt))) {
      await update($, firstPrompt, () => t.replace(/\s+/g, ' ').slice(0, 50))
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const r = await next(e)
    const u = e.usage
    const spent = u
      ? u.input_tokens +
        u.output_tokens +
        u.cache_read_input_tokens +
        u.cache_creation_input_tokens
      : 0
    if (u) {
      await update($, live, l => ({
        ...l,
        input: l.input + u.input_tokens,
        output: l.output + u.output_tokens,
        cacheRead: l.cacheRead + u.cache_read_input_tokens,
        cacheWrite: l.cacheWrite + u.cache_creation_input_tokens,
        turns: e.agentId === undefined ? l.turns + 1 : l.turns,
      }))
    }
    await refresh($)

    const l = await read($, live)
    const id = await $.session.id()
    const now = await $.clock.now()

    // Chats: re-read the store so other open chats' numbers are kept.
    const chats = await loadChats($)
    // A name saved earlier in this chat wins: that was its first message.
    const saved = chats[id]?.title
    const title =
      saved && saved !== 'untitled chat' ? saved : (await read($, firstPrompt)) || 'untitled chat'
    chats[id] = {
      id,
      title,
      tokens: total(l),
      usd: l.usd,
      turns: l.turns,
      updatedAt: now,
    }
    const keptChats: Chats = {}
    for (const c of Object.values(chats)
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_CHATS)) {
      keptChats[c.id] = c
    }
    await $.store.set(CHATS, keptChats)
    await update($, chatsAtom, () => keptChats)

    // Days: add this turn's tokens to today.
    const days = await loadDays($)
    const key = dayKey(now)
    const today = days[key] ?? { tokens: 0, chats: [] }
    days[key] = {
      tokens: today.tokens + spent,
      chats: today.chats.includes(id) ? today.chats : [...today.chats, id],
    }
    const keptDays: Days = {}
    for (const k of Object.keys(days).sort().slice(-MAX_DAYS)) {
      const d = days[k]
      if (d) keptDays[k] = d
    }
    await $.store.set(DAYS, keptDays)
    await update($, daysAtom, () => keptDays)

    // This chat's days, and the sync.
    await update($, chatDays, d => {
      const next2 = { ...d, [key]: (d[key] ?? 0) + spent }
      const keys = Object.keys(next2).sort()
      for (const k of keys.slice(0, Math.max(0, keys.length - MAX_DAYS))) delete next2[k]

      return next2
    })
    if (isSyncOn) {
      const rec: SyncRecord = {
        v: 1,
        title,
        tokens: total(l),
        usd: l.usd,
        turns: l.turns,
        updatedAt: now,
        days: await read($, chatDays),
      }
      try {
        await push($, id, rec, now)
        await update($, syncState, () => 'synced' as const)
      } catch {
        await update($, syncState, () => 'local' as const)
      }
    }

    return r
  })

  // /usage: the built-in output, our report, and the calendar panel.
  on('command.run', { command: 'usage' }, async ($, e, next) => {
    await openPane($).catch(() => undefined)
    const ours = await report($).catch(() => 'Usage meter: report unavailable right now.')
    try {
      const r = await next(e)

      return { ...r, text: r.text ? `${r.text}\n\n${ours}` : ours }
    } catch {
      return { text: ours, isTextDisplayOnly: true }
    }
  })

  on('command.run', { command: 'usage-tips' }, async $ => {
    await openPane($).catch(() => undefined)

    return { text: await report($), isTextDisplayOnly: true as const }
  })

  // ── the band above the prompt ──────────────────────────────────────────
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const l = await read($, live)
    const ui = $.ui.resolve(e)
    const { Box, Button, Text } = ui
    const warn = l.contextPct >= 60

    // Hidden: one short line, with a button to bring the full bar back.
    if (await read($, isHidden)) {
      return (
        <Box>
          <Text color={ACCENT}>◆ </Text>
          <Text dimColor>{fmt(total(l))} tok · </Text>
          <Text color={warn ? 'yellow' : undefined} dimColor={!warn}>
            ctx {l.contextPct}%
          </Text>
          <Text> </Text>
          <Button key="show" label="Show usage" onPress={() => setHidden($, false)} />
        </Box>
      )
    }

    const rem = await read($, remote)
    const id = await $.session.id()
    const chats = chatsOf(await read($, chatsAtom), rem)
    const days = statsOf(await read($, daysAtom), rem, id, await read($, chatDays))
    const now = await $.clock.now()
    const best = topChats(chats, 1)[0]
    const limits = l.limits.map(x => `${limitName(x.kind)} ${x.percentUsed}%`).join(' · ')
    const todayTok = days[dayKey(now)]?.tokens ?? 0
    const cells = lastDays(days, now, 30)

    const summary = (
      <Box>
        <Text color={ACCENT} bold>
          ◆ Usage{'  '}
        </Text>
        <Text bold>{fmt(total(l))}</Text>
        <Text dimColor> tok this chat · ~${l.usd.toFixed(2)} · today {fmt(todayTok)} · </Text>
        <Text color={warn ? 'yellow' : undefined} dimColor={!warn}>
          context {l.contextPct}%
        </Text>
        {limits ? <Text dimColor> · {limits}</Text> : null}
      </Box>
    )

    const footer = (
      <Box>
        <Text dimColor>
          {best ? `Top chat: "${best.title}" ${fmt(best.tokens)} · ` : ''}
          {warn ? 'Tip: /compact to shrink context · ' : ''}
        </Text>
        <Button key="open" label="Details" onPress={() => openPane($)} />
        <Text> </Text>
        <Button key="hide" label="Hide" onPress={() => setHidden($, true)} />
      </Box>
    )

    if (e.surface !== 'terminal' && 'Svg' in ui) {
      const { Svg } = ui

      return (
        <Box flexDirection="column">
          {summary}
          <Svg source={stripSvg(cells)} alt="Tokens per day, last 30 days" isInteractive />
          {footer}
        </Box>
      )
    }

    // Terminal: a row of squares; pointing at one shows that day below it.
    return (
      <Box flexDirection="column">
        {summary}
        <Box>
          {cells.map(c => (
            <Box key={`b-${c.key}`} hover={{ scope: `um-${c.key}` }}>
              <Text color={LEVELS[c.level]}>■</Text>
            </Box>
          ))}
          <Text dimColor> last 30 days</Text>
        </Box>
        <Box position="relative">
          {footer}
          {cells.map(c => (
            <Box
              position="absolute"
              top={0}
              left={0}
              display="none"
              hover={{ scope: `um-${c.key}`, display: 'flex' }}
            >
              <Text color={ACCENT}>{tipFor(c).padEnd(Math.max(10, e.props.bodyColumns - 1))}</Text>
            </Box>
          ))}
        </Box>
      </Box>
    )
  })

  // ── the Usage panel: full calendar, top chats, tips ───────────────────
  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const l = await read($, live)
    const rem = await read($, remote)
    const id = await $.session.id()
    const chats = chatsOf(await read($, chatsAtom), rem)
    const days = statsOf(await read($, daysAtom), rem, id, await read($, chatDays))
    const sync = await read($, syncState)
    const now = await $.clock.now()
    const ui = $.ui.resolve(e)
    const { Box, Text } = ui
    const cols = Math.max(20, e.props.bodyColumns)
    const isApp = e.surface !== 'terminal' && 'Svg' in ui
    const weeks = isApp ? 26 : Math.max(4, Math.min(26, Math.floor((cols - 5) / 2)))
    const cal = calendar(days, now, weeks)
    const flat = cal.flat()
    const spanTotal = flat.reduce((n, c) => n + c.tokens, 0)
    const activeDays = flat.filter(c => c.tokens > 0).length
    const ranked = topChats(chats, 5)

    const heading = (s: string) => (
      <Text bold color={ACCENT}>
        {s}
      </Text>
    )

    let grid
    if (isApp && 'Svg' in ui) {
      const { Svg } = ui
      grid = (
        <Svg
          source={calendarSvg(cal)}
          alt={`Daily token usage, last ${weeks} weeks`}
          isInteractive
        />
      )
    } else {
      grid = (
        <Box flexDirection="column">
          {[0, 1, 2, 3, 4, 5, 6].map(row => (
            <Box>
              <Text dimColor>{row % 2 === 1 ? WEEKDAYS[row] : '   '} </Text>
              {cal.map(col => {
                const c = col[row]

                return c ? (
                  <Box key={`p-${c.key}`} hover={{ scope: `ump-${c.key}` }}>
                    <Text color={LEVELS[c.level]}>■ </Text>
                  </Box>
                ) : (
                  <Text>{'  '}</Text>
                )
              })}
            </Box>
          ))}
          <Box position="relative">
            <Box>
              <Text dimColor>{'    '}Less </Text>
              {LEVELS.map(c => (
                <Text color={c}>■ </Text>
              ))}
              <Text dimColor>More · point at a square to see that day</Text>
            </Box>
            {flat.map(c => (
              <Box
                position="absolute"
                top={0}
                left={0}
                display="none"
                hover={{ scope: `ump-${c.key}`, display: 'flex' }}
              >
                <Text color={ACCENT}>{`    ${tipFor(c)}`.padEnd(cols - 1)}</Text>
              </Box>
            ))}
          </Box>
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          {heading(`${fmt(spanTotal)} tokens in the last ${weeks} weeks`)}
          <Text dimColor>
            {activeDays} active day{activeDays === 1 ? '' : 's'} · today{' '}
            {fmt(days[dayKey(now)]?.tokens ?? 0)}
          </Text>
          <Text dimColor>{syncNote(sync, rem)}</Text>
        </Box>
        {grid}
        <Box flexDirection="column">
          {heading('This chat')}
          <Text>
            {fmt(total(l))} tokens · {l.turns} turns · ~${l.usd.toFixed(2)}{' '}
            <Text dimColor>(estimate, not your bill)</Text>
          </Text>
          <Text dimColor>
            input {fmt(l.input)} · cache read {fmt(l.cacheRead)} · cache write{' '}
            {fmt(l.cacheWrite)} · output {fmt(l.output)}
          </Text>
          <Text color={l.contextPct >= 60 ? 'yellow' : undefined}>
            context window {l.contextPct}% full
          </Text>
          {l.limits.map(x => (
            <Text color={x.percentUsed >= 70 ? 'yellow' : undefined}>
              {limitName(x.kind)}: {x.percentUsed}% used
            </Text>
          ))}
        </Box>
        <Box flexDirection="column">
          {heading('Chats using the most')}
          {ranked.length === 0 ? <Text dimColor>Nothing yet: finish a turn first.</Text> : null}
          {ranked.map((c, i) => (
            <Text>
              <Text dimColor>{i + 1}. </Text>
              <Text bold>{fmt(c.tokens).padStart(6)}</Text>
              <Text> {c.title}</Text>
              <Text dimColor> · {c.turns} turns</Text>
            </Text>
          ))}
        </Box>
        <Box flexDirection="column">
          {heading('Ways to cut usage')}
          {tips(l, chats).map(t => (
            <Text>• {t}</Text>
          ))}
        </Box>
      </Box>
    )
  })
}
