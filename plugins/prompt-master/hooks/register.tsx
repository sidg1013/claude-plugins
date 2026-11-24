import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

const INSTRUCTIONS = `You are Prompt Master. Your job is to turn the short, vague request in this message into a complete, high-quality prompt BEFORE answering it.

HOW YOU WORK:
1. Do NOT answer the original request right away.
2. First, figure out what the person is actually trying to do: the goal, who it's for, and what a good result looks like.
3. If key details are missing, ask up to 3 short clarifying questions. Only ask what you actually need. If the request is already clear, skip the questions and just rewrite it.
4. Then rewrite the request into an optimized prompt using this structure:
   - Role: who you should act as
   - Task: the exact job to do
   - Context: any background that changes the answer
   - Audience: who it's for
   - Format: length, structure, and style
   - Constraints: what to avoid, limits, tone
   - Success criteria: what makes the answer good
5. Show the rewritten prompt first, in a code block.
6. Ask: "Want me to run this?" If they say yes / go / run it, run the rewritten prompt and give the answer.

RULES:
- Keep the original intent. Don't change what was asked for, just make it clearer and more specific.
- Don't invent details about the person, their business, or their topic. If something is missing, use a [bracketed placeholder] or ask.
- Keep the rewritten prompt concise but complete. No fluff, no generic advice.
- Use plain language. No prompt-engineering jargon in the output.

EXAMPLE:
Input: "help me study for APUSH"
Rewritten prompt, something like:
Role: APUSH tutor for a high school student. Task: Make a study plan for Unit 4, Chapters 10-15, Period 4 (1800-1848). Context: Test is all short-answer questions. Format: Key terms with what/when/why-it-matters, plus 3 practice SAQs with model answers. Constraints: Use specific names and dates as evidence, keep it to what will actually be tested.`

// Armed by the button: the next message the person sends is rewritten first.
// (The web and mobile apps keep the draft on the device until it is sent, so
// the button cannot read what is typed; it arms the next send instead.)
const armed = atom({ plugin: 'prompt-master', key: 'armed' } as const, false)

// Requests sent through /prompt-master that are waiting for their submit.
const pending = new Set<string>()

const PERSON = new Set(['composer', 'bridge', 'sdk', 'unclassified'])

async function send($: EngineInterface, request: string): Promise<boolean> {
  const text = request.trim()
  if (!text) return false
  pending.add(text)
  await $.prompt.submit({ text, asUser: true })
  return true
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'prompt-master',
      description: 'Rewrite your request into a complete prompt before answering it',
    })
    return next(e)
  })

  on('command.run', { command: 'prompt-master' }, async ($, e) => {
    if (await send($, e.args)) {
      return { text: 'Prompt Master: rewriting your request first.', isTextDisplayOnly: true }
    }
    await update($, armed, () => true)
    return {
      text: 'Prompt Master is on: your next message will be rewritten first.',
      isTextDisplayOnly: true,
    }
  })

  on('prompt.submit', async ($, e, next) => {
    const key = e.text.trim()
    if (pending.has(key)) {
      pending.delete(key)
      return next({ ...e, context: [...(e.context ?? []), INSTRUCTIONS] })
    }
    if (key && PERSON.has(e.origin.kind) && !key.startsWith('/') && (await read($, armed))) {
      await update($, armed, () => false)
      return next({ ...e, context: [...(e.context ?? []), INSTRUCTIONS] })
    }
    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) return next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const isOn = await read($, armed)
    return (
      <Box>
        <Button
          key="prompt-master"
          label={isOn ? 'Prompt Master: ON' : 'Prompt Master'}
          onPress={async () => {
            const { text } = await $.prompt.read()
            if (text.trim() && (await send($, text))) {
              await $.prompt.fill({ text: '', mode: 'replace' })
              return
            }
            await update($, armed, was => !was)
          }}
        />
        {isOn && <Text dimColor> Your next message will be rewritten first. Tap again to cancel.</Text>}
      </Box>
    )
  })
}
