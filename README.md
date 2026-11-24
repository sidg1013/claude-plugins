# claude-plugins

My Claude Code plugins, mods and skills, all in one marketplace.

| Plugin | What it does |
| --- | --- |
| [usage-meter](plugins/usage-meter) | Token usage bar above the prompt with a daily usage calendar (hover a day for its tokens), your heaviest chats, and tips to cut usage |
| [prompt-master](plugins/prompt-master) | A Prompt Master button above the prompt box (and `/pm`) that rewrites your next request into a complete, structured prompt before answering it, plus a matching skill |

## Install

Add the marketplace once per machine:

```
/plugin marketplace add sidg1013/claude-plugins
```

Then install any plugin from it, choosing the user scope so it loads in every session:

```
/plugin install usage-meter@sidg1013-plugins
/plugin install prompt-master@sidg1013-plugins
```

When a new plugin is added here, pull the updated list and install it:

```
/plugin marketplace update sidg1013-plugins
/plugin install <plugin>@sidg1013-plugins
```

In the desktop app: click + next to the prompt box, then Plugins, Add marketplace with
`sidg1013/claude-plugins`, then add the plugins you want.

## Adding a plugin

1. Make a folder under `plugins/<name>/` with `.claude-plugin/plugin.json`
   (`{ "name": "<name>", "version": "0.1.0", "description": "..." }`) and its contents:
   - a skill: `skills/<skill-name>/SKILL.md`
   - a mod: `hooks/hooks.json` and its hooks module
   - slash commands: `commands/<command>.md`
2. Add an entry for it to `plugins` in `.claude-plugin/marketplace.json`, with
   `"source": "./plugins/<name>"`.
3. Add it to the table above, commit and push.
