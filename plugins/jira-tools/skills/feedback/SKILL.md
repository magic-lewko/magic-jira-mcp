---
name: feedback
description: Collect improvement feedback about the jira-tools plugin through a short interview and produce a ready-to-paste Slack message for the plugin maintainers. Use when the user says "/feedback", "I have an idea for the plugin", "it would be useful in the plugin", "report a suggestion to jira-tools", or complains about missing plugin functionality.
---

Turn the user's idea or pain point into actionable feedback for the plugin maintainers. Respond in the user's language. Initial input (may be empty): $ARGUMENTS

## GOLDEN RULE — do not invent on the user's behalf

You collect and organize what the user said. **Do not add justifications, examples, or priority they didn't provide** — that's what the questions are for. A field with no answer stays empty (`none`), not filled with your guess. You may shorten and organize their words; you may not add content.

## Steps

1. **Mini-interview** — ask ONLY for what's still missing after reading their initial input (one AskUserQuestion round, max 3 questions):
   - What should the plugin do / what is broken? (concrete behaviour, not a solution)
   - What problem does it solve — when did they last need it?
   - How painful is the gap: nice-to-have / weekly annoyance / daily blocker?

2. **Optional example** — if the idea concerns an existing flow, ask for (or reconstruct from the conversation) one concrete example: the prompt they typed and what they expected vs got.

3. **Produce the Slack message** — a single fenced block, ready to copy-paste (labels in the user's language):

   ```text
   📦 jira-tools — feedback from <name, if known>

   Idea/problem: <1-2 sentences>
   Rationale: <what problem it solves, how often it hurts>
   Example: <prompt → expected vs actual, or "none">
   Reporter's priority: <nice-to-have / weekly / daily blocker>
   Plugin version: <from .claude-plugin/plugin.json in the plugin directory, if available — otherwise skip>
   ```

4. **Optional ticket** — ONLY when the user explicitly asks to file it as a Jira ticket AND write tools are available: follow the standard flow — full dry-run preview, explicit confirmation, then ONE `create_issue` to the project the user names. No exceptions to the preview→confirm rule for "internal" tickets. (The server adds the `ai-generated` label automatically.)

Never send anything anywhere yourself — the Slack message is handed to the user to paste.
