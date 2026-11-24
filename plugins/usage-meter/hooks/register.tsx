import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { ChatRecord, Chats, Days, Live } from '../types'

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
const isHidden = atom({ plugin: 'usage-meter', key: 'isHidden' } as const, false)

const PANE = 'usage-meter'
const CHATS = 'chats-v1'
const DAYS = 'days-v1'
const MAX_CHATS = 200
const MAX_DAYS = 400
const DAY_MS = 86400000

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

const cellOf = (days: Days, ms: number): Cell => {
  const key = dayKey(ms)
  const d = days[key]

  return { key, ms, tokens: d?.tokens ?? 0, chats: d?.chats.length ?? 0, level: 0 }
}

const leveled = (cells: Cell[]): void => {
  const max = cells.reduce((m, c) => Math.max(m, c.tokens), 0)
  for (const c of cells) c.level = levelOf(c.tokens, max)
}

/** The calendar: `weeks` columns of Sunday→Saturday, ending with today's week. */
function calendar(days: Days, now: number, weeks: number): Cell[][] {
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
function lastDays(days: Days, now: number, n: number): Cell[] {
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

async function openPane($: EngineInterface): Promise<void> {
  await $.ui.open({ id: PANE, title: 'Usage' })
}

async function report($: EngineInterface): Promise<string> {
  await refresh($)
  const l = await read($, live)
  const chats = await read($, chatsAtom)
  const days = await read($, daysAtom)
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

export const register: Register = on => {
  let title = ''

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
    await refresh($)

    return r
  })

  on('prompt.submit', async ($, e, next) => {
    const t = e.text.trim()
    if (!title && t && !t.startsWith('/')) title = t.replace(/\s+/g, ' ').slice(0, 50)

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
    chats[id] = {
      id,
      title: title || chats[id]?.title || 'untitled chat',
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
    if (e.props.hasSurvey || (await read($, isHidden))) return next(e)
    const l = await read($, live)
    const chats = await read($, chatsAtom)
    const days = await read($, daysAtom)
    const now = await $.clock.now()
    const best = topChats(chats, 1)[0]
    const ui = $.ui.resolve(e)
    const { Box, Button, Text } = ui
    const warn = l.contextPct >= 60
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
        <Button key="hide" label="Hide" onPress={() => update($, isHidden, () => true)} />
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
    const chats = await read($, chatsAtom)
    const days = await read($, daysAtom)
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
