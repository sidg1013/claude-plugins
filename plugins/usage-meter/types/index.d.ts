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

/** A day across every chat shown: total tokens and how many chats used any. */
export type DayStat = { tokens: number; chats: number }
export type Stats = Record<string, DayStat>

/** One chat's numbers as synced to Google Drive (a file's description). */
export type SyncRecord = {
  v: 1
  title: string
  tokens: number
  usd: number
  turns: number
  updatedAt: number
  /** Tokens per local date, `YYYY-MM-DD`. */
  days: Record<string, number>
}

/** Every chat's synced record, by chat id, and when they were read. */
export type Remote = { records: Record<string, SyncRecord>; syncedAt: number }

/** `off` sync is turned off; `local` Drive not reachable; `synced` all good. */
export type SyncState = 'off' | 'local' | 'synced'

declare module 'claude-code' {
  interface PluginState {
    'usage-meter': {
      live: Shaped<Live>
      chats: Shaped<Chats>
      days: Shaped<Days>
      firstPrompt: string
      chatDays: Shaped<Record<string, number>>
      remote: Shaped<Remote | null>
      syncState: SyncState
      isHidden: boolean
    }
  }
}
