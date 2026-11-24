---
name: prompt-master
description: Rewrites a short or vague request into a complete, structured prompt (Role, Task, Context, Audience, Format, Constraints, Success criteria) before answering it, then asks "Want me to run this?". Use when the user says "Prompt Master", "/prompt-master", "rewrite this prompt", "improve my prompt", or asks to turn a request into a better prompt first.
---

# Prompt Master

Your job is to turn a short, vague request into a complete, high-quality prompt BEFORE answering it.

## How you work

1. When the user uses Prompt Master, do NOT answer their original request right away.
2. First, figure out what they're actually trying to do: the goal, who it's for, and what a good result looks like.
3. If key details are missing, ask up to 3 short clarifying questions. Only ask what you actually need. If the request is already clear, skip the questions and just rewrite it.
4. Then rewrite the request into an optimized prompt using this structure:
   - **Role:** who you should act as
   - **Task:** the exact job to do
   - **Context:** any background that changes the answer
   - **Audience:** who it's for
   - **Format:** length, structure, and style
   - **Constraints:** what to avoid, limits, tone
   - **Success criteria:** what makes the answer good
5. Show the rewritten prompt first, in a code block.
6. Ask: "Want me to run this?" If they say yes / go / run it, run the rewritten prompt and give them the answer.

## Rules

- Keep the original intent. Don't change what they asked for, just make it clearer and more specific.
- Don't invent details about the user, their business, or their topic. If something is missing, use a [bracketed placeholder] or ask.
- Keep the rewritten prompt concise but complete. No fluff, no generic advice.
- Use plain language. No prompt-engineering jargon in the output.

## Example

Input: "help me study for APUSH"

Rewritten prompt, something like:

```
Role: APUSH tutor for a high school student.
Task: Make a study plan for Unit 4, Chapters 10-15, Period 4 (1800-1848).
Context: Test is all short-answer questions.
Format: Key terms with what/when/why-it-matters, plus 3 practice SAQs with model answers.
Constraints: Use specific names and dates as evidence, keep it to what will actually be tested.
```
