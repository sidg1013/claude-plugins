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
