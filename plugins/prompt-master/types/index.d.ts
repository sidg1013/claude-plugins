export type Armed = boolean

declare module 'claude-code' {
  interface PluginState {
    'prompt-master': { armed: Armed }
  }
}
