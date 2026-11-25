# usage-meter

A Claude Code mod that shows your token usage in every chat.

- **A bar above the prompt** with this chat's tokens, an estimated cost, today's total, how full the
  context window is, and your 5-hour and weekly limit usage. Below it is a row of squares for the
  last 30 days. Hover a square to see that day's date, tokens and number of chats.
  Click **Hide** to shrink it to one short line; **Show usage** brings it back. Your choice carries
  over to new chats.
- **A Usage panel**, opened with `/usage`, `/usage-tips` or the bar's Details button. It shows a
  26-week calendar of daily usage (hover any day), this chat's token breakdown, the five chats that
  used the most tokens, and suggestions for using fewer tokens.

## Sync across machines and cloud chats

If Google Drive is connected to Claude (claude.ai → Settings → Connectors), each chat keeps its
token counts in a **Claude usage-meter** folder in that Drive: one small file per chat, with the
numbers in the file's description. The calendar, today's total and "Chats using the most" then
cover every chat on every machine and cloud environment, not just the one you're in. Drive calls
use no Claude tokens. Without Drive, it shows this machine only and says so.

To turn syncing off, set **Sync through Google Drive** to off in the plugin's settings
(`/plugin` → usage-meter → configure).

Costs are local estimates, not your bill. Usage is counted from when the mod is installed.

## Install

```
/plugin install usage-meter --marketplace sidg1013/claude-plugins
```

Answer `y` to add the marketplace, then pick the user scope so it loads in every session.

From a shell:

```
claude plugin install usage-meter --marketplace sidg1013/claude-plugins
```

In the desktop app: click + next to the prompt box, then Plugins, Add marketplace with
`sidg1013/claude-plugins`, then Add plugin.
