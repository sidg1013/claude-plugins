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

Costs are local estimates, not your bill. Usage is counted from when the mod is installed, on the
machine it runs on.

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
