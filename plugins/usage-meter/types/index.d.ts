export type Live = {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  turns: number
  usd: number
  contextPct: number
  limits: { kind: string; percentUsed: number }[]
}

export type ChatRecord = {
  id: string
  title: string
  tokens: number
  usd: number
  turns: number
  updatedAt: number
}

/** One calendar day: tokens used and the chats that used them. */
export type Day = { tokens: number; chats: string[] }

export type Chats = Record<string, ChatRecord>
/** Keyed by local date, `YYYY-MM-DD`. */
export type Days = Record<string, Day>

declare module 'claude-code' {
  interface PluginState {
    'usage-meter': {
      live: Shaped<Live>
      chats: Shaped<Chats>
      days: Shaped<Days>
      firstPrompt: string
      isHidden: boolean
    }
  }
}
