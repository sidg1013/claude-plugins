# Prompt Master

Turns a short, vague request into a complete, structured prompt (Role, Task, Context, Audience, Format, Constraints, Success criteria) before answering it. Claude asks up to three clarifying questions only when needed, shows the rewritten prompt in a code block, and asks "Want me to run this?" before running it.

## Use

- **Button:** tap **Prompt Master** above the prompt box. It turns to **Prompt Master: ON**, and the next message you send is rewritten first. Tap again to cancel. (In a terminal, if you've already typed your request, the button sends it straight away.)
- **Command:** `/pm <what you want>`, or `/pm` alone to turn the button on.
- **Skill:** say "Prompt Master: <what you want>" in any chat.

## Install

```
/plugin install prompt-master --marketplace sidg1013/claude-plugins
```

Answer `y` to add the marketplace, then pick the user scope so it loads in every session.

From a shell:

```
claude plugin install prompt-master --marketplace sidg1013/claude-plugins
```

In the desktop app: click + next to the prompt box, then Plugins, Add marketplace with
`sidg1013/claude-plugins`, then Add plugin.
