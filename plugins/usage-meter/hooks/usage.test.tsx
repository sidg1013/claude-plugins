import { expect, test } from 'claude-code/testing'

const NOW = Date.UTC(2026, 10, 24, 15)
const BAND_PROPS = {
  hasSurvey: false,
  isCollapsed: false,
  isWorking: false,
  maxRows: 12,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 12 },
  view: {},
}
const PANE_PROPS = {
  title: 'Usage',
  isFocused: false,
  bodyColumns: 70,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function seed($: any, on: any) {
  const store: Record<string, unknown> = {
    'days-v1': { '2026-11-20': { tokens: 900000, chats: ['old'] } },
  }
  on('store.get', (_: unknown, e: { key: string }) => ({ value: store[e.key] }))
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => {
    store[e.key] = e.value
    return { value: undefined }
  })
  on('command.register', () => ({ value: { command: 'usage-tips' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('clock.now', () => ({ value: NOW }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { tokens: 140000, window: 200000, percent: 70 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 80 }],
      cost: { usd: 1.5 },
    },
  }))
  on('prompt.submit', (_: unknown, e: { text: string }) => ({ text: e.text }))
  on('turn.complete', () => ({ text: 'ok' }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.prompt.submit({ text: 'Refactor the billing module' } as never)
  await $.turn.complete({
    answer: 'ok',
    durationMs: 1000,
    isAborted: false,
    turnId: 't1',
    reason: 'answer',
    usage: {
      input_tokens: 1000,
      output_tokens: 20000,
      cache_read_input_tokens: 5000,
      cache_creation_input_tokens: 30000,
      model: 'm',
    },
  })

  return store
}

test('band on the desktop: summary and a hoverable 30-day strip', async ($, on) => {
  await seed($, on)
  const ui = await $.ui.mount({
    plugin: 'usage-meter',
    component: 'AbovePrompt',
    surface: 'desktop',
    props: BAND_PROPS,
  } as never)
  expect((await ui.find({ type: 'Text', text: /tok this chat/ }))?.text).toContain('today 56.0k')
  const svg = await ui.find({ type: 'Svg' })
  expect(String(svg?.props?.source)).toContain('<title>Tue, Nov 24, 2026 · 56,000 tokens · 1 chat</title>')
  expect(String(svg?.props?.source)).toContain('900,000 tokens')
  await ui.unmount()
})

test('band in the terminal draws squares', async ($, on) => {
  await seed($, on)
  const ui = await $.ui.mount({
    plugin: 'usage-meter',
    component: 'AbovePrompt',
    surface: 'terminal',
    props: BAND_PROPS,
  } as never)
  expect((await ui.find({ type: 'Text', text: /last 30 days/ }))?.text).toBeTruthy()
  await ui.unmount()
})

for (const surface of ['desktop', 'terminal', 'mobile'] as const) {
  test(`usage pane on ${surface}`, async ($, on) => {
    await seed($, on)
    const ui = await $.ui.mount({
      plugin: 'usage-meter',
      component: 'Pane',
      requestId: 'usage-meter',
      surface,
      props: PANE_PROPS,
    } as never)
    expect((await ui.find({ type: 'Text', text: /Refactor the billing module/ }))?.text).toBeTruthy()
    expect((await ui.find({ type: 'Text', text: /tokens in the last/ }))?.text).toContain('956.0k')
    await ui.unmount()
  })
}

test('/usage-tips report', async ($, on) => {
  await seed($, on)
  const r = await $.command.run({ command: 'usage-tips' } as never)
  expect(r.text).toContain('Chats using the most tokens')
  expect(r.text).toContain('/compact')
  expect(r.text).toContain('5h limit is at 80%')
})

test('Hide shrinks the bar to one line; Show usage brings it back; the choice is remembered', async ($: any, on: any) => {
  const store = await seed($, on)
  const band = () =>
    $.ui.mount({ plugin: 'usage-meter', component: 'AbovePrompt', surface: 'desktop', props: BAND_PROPS } as never)

  let ui = await band()
  await ui.press({ key: 'hide' })
  await ui.unmount()

  ui = await band()
  expect(await ui.find({ type: 'Text', text: /tok this chat/ })).toBeFalsy()
  expect((await ui.find({ type: 'Text', text: /ctx 70%/ }))?.text).toBeTruthy()
  const show = await ui.find({ type: 'Button', key: 'show' })
  expect(show?.props?.label).toBe('Show usage')
  expect(store['hidden-v1']).toBe(true)
  await ui.press({ key: 'show' })
  await ui.unmount()

  ui = await band()
  expect((await ui.find({ type: 'Text', text: /tok this chat/ }))?.text).toBeTruthy()
  await ui.unmount()
})

test('the chat is named after its first message, not a later one', async ($: any, on: any) => {
  const store = await seed($, on)
  await $.prompt.submit({ text: 'A later message' } as never)
  await $.turn.complete({
    answer: 'ok', durationMs: 1, isAborted: false, turnId: 't2', reason: 'answer',
    usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'm' },
  })
  const chats = store['chats-v1'] as Record<string, { title: string }>
  expect(chats['sess-1']?.title).toBe('Refactor the billing module')
})

/** A Google Drive connector in memory, answering the calls usage-meter makes. */
function fakeDrive(on: any, files: Record<string, any>) {
  let n = 0
  const ok = (v: unknown) => ({ value: { isError: false, content: [{ type: 'text', text: JSON.stringify(v) }] } })
  on('mcp.call', (_: unknown, e: { server: string; tool: string; args: any }) => {
    if (e.server !== 'Google Drive') throw new Error('no such server')
    const a = e.args
    if (e.tool === 'create_file') {
      const id = `f${++n}`
      files[id] = { id, title: a.title, parentId: a.parentId, mimeType: a.contentMimeType }
      return ok(files[id])
    }
    if (e.tool === 'update_file') {
      if (!files[a.fileId]) return { value: { isError: true, content: [{ type: 'text', text: 'not found' }] } }
      files[a.fileId].description = a.description
      return ok(files[a.fileId])
    }
    if (e.tool === 'search_files') {
      const q: string = a.query
      const all = Object.values(files)
      let hits
      if (q.includes("mimeType = 'application/vnd.google-apps.folder'")) {
        hits = all.filter(f => f.mimeType === 'application/vnd.google-apps.folder' && f.title === 'Claude usage-meter')
      } else if (q.startsWith('title = ')) {
        const t = q.match(/^title = '(.*)' and/)![1]
        hits = all.filter(f => f.title === t)
      } else {
        const parents = [...q.matchAll(/parentId = '([^']+)'/g)].map(m => m[1])
        hits = all.filter(f => parents.includes(f.parentId))
      }
      return ok({ files: hits })
    }
    throw new Error(`unexpected tool ${e.tool}`)
  })
}

test('syncs through Google Drive: other machines and cloud chats show up', async ($: any, on: any) => {
  const drive: Record<string, any> = {
    folder: { id: 'folder', title: 'Claude usage-meter', mimeType: 'application/vnd.google-apps.folder' },
    a: {
      id: 'a', title: 'usage-meter chat laptop-1', parentId: 'folder',
      description: JSON.stringify({ v: 1, title: 'Laptop chat', tokens: 3000000, usd: 2, turns: 9, updatedAt: 5, days: { '2026-11-24': 3000000 } }),
    },
    b: {
      id: 'b', title: 'usage-meter chat cloud-2', parentId: 'folder',
      description: JSON.stringify({ v: 1, title: 'Cloud chat', tokens: 100000, usd: 1, turns: 2, updatedAt: 6, days: { '2026-11-23': 100000 } }),
    },
    junk: { id: 'junk', title: 'notes', parentId: 'folder', description: 'not json' },
  }
  fakeDrive(on, drive)
  await seed($, on)

  // This chat wrote its own record into the folder.
  const mine = Object.values(drive).find((f: any) => f.title === 'usage-meter chat sess-1')
  expect(mine?.parentId).toBe('folder')
  expect(JSON.parse(mine.description).days['2026-11-24']).toBe(56000)

  const r = await $.command.run({ command: 'usage-tips' } as never)
  expect(r.text).toContain('Laptop chat')
  expect(r.text).toContain('Synced with Google Drive: 3 chats')
  // Today: the laptop's 3M plus this chat's 56k.
  expect(r.text).toContain('Today: 3.1M tokens')

  const ui = await $.ui.mount({
    plugin: 'usage-meter', component: 'Pane', requestId: 'usage-meter', surface: 'desktop', props: PANE_PROPS,
  } as never)
  const svg = await ui.find({ type: 'Svg' })
  expect(String(svg?.props?.source)).toContain('Tue, Nov 24, 2026 · 3,056,000 tokens · 2 chats')
  expect(String(svg?.props?.source)).toContain('Mon, Nov 23, 2026 · 100,000 tokens · 1 chat')
  await ui.unmount()
})

test('without Drive it falls back to this machine and says so', async ($: any, on: any) => {
  await seed($, on)
  const r = await $.command.run({ command: 'usage-tips' } as never)
  expect(r.text).toContain('This machine only: connect Google Drive')
})

test('sync can be turned off', { options: { driveSync: false } }, async ($: any, on: any) => {
  const drive: Record<string, any> = {}
  fakeDrive(on, drive)
  await seed($, on)
  expect(Object.keys(drive)).toHaveLength(0)
  const r = await $.command.run({ command: 'usage-tips' } as never)
  expect(r.text).toContain('Drive sync is turned off')
})

test('a background notice is not taken as the chat name', async ($: any, on: any) => {
  const store: Record<string, unknown> = {}
  on('store.get', (_: unknown, e: { key: string }) => ({ value: store[e.key] }))
  on('store.set', (_: unknown, e: { key: string; value: unknown }) => {
    store[e.key] = e.value
    return { value: undefined }
  })
  on('command.register', () => ({ value: { command: 'usage-tips' } }))
  on('session.start', (_: unknown, e: { cwd: string }) => ({ cwd: e.cwd }))
  on('clock.now', () => ({ value: NOW }))
  on('session.id', () => ({ value: 's2' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 1, percent: 1 }, rateLimits: [] } }))
  on('prompt.submit', (_: unknown, e: { text: string }) => ({ text: e.text }))
  on('turn.complete', () => ({ text: 'ok' }))
  const usage = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0, model: 'm' }
  const turn = (id: string) =>
    $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: id, reason: 'answer', usage })

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.prompt.submit({ text: '<task-notification> mods loaded', origin: { kind: 'task-notification' } } as never)
  await turn('t1')
  await $.prompt.submit({ text: 'Fix the login page', origin: { kind: 'composer' } } as never)
  await turn('t2')
  await $.prompt.submit({ text: 'and the footer', origin: { kind: 'composer' } } as never)
  await turn('t3')

  expect((store['chats-v1'] as any)['s2'].title).toBe('Fix the login page')
})
