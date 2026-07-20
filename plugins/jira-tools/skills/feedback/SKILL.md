---
name: feedback
description: Collect improvement feedback about the jira-tools plugin through a short interview and produce a ready-to-paste Slack message for the plugin maintainers. Use when the user says "/feedback", "mam pomysł na plugin", "przydałoby się w pluginie", "zgłoś sugestię do jira-tools", or complains about missing plugin functionality.
---

Turn the user's idea or pain point into actionable feedback for the plugin maintainers. Respond in the user's language. Initial input (may be empty): $ARGUMENTS

## ZŁOTA ZASADA — nie wymyślaj za użytkownika

Zbierasz i porządkujesz to, co powiedział użytkownik. **Nie dopisujesz uzasadnień, przykładów ani priorytetu, których nie podał** — od tego jest pytanie. Pole bez odpowiedzi zostaje puste (`brak`), a nie wypełnione Twoim domysłem. Wolno Ci skrócić i uporządkować jego słowa; nie wolno dokładać treści.

## Steps

1. **Mini-interview** — ask ONLY for what's still missing after reading their initial input (one AskUserQuestion round, max 3 questions):
   - What should the plugin do / what is broken? (concrete behaviour, not a solution)
   - What problem does it solve — when did they last need it?
   - How painful is the gap: nice-to-have / weekly annoyance / daily blocker?

2. **Optional example** — if the idea concerns an existing flow, ask for (or reconstruct from the conversation) one concrete example: the prompt they typed and what they expected vs got.

3. **Produce the Slack message** — a single fenced block, ready to copy-paste:

   ```text
   📦 jira-tools — feedback od <imię, jeśli znane>

   Pomysł/problem: <1-2 zdania>
   Uzasadnienie: <jaki problem rozwiązuje, jak często boli>
   Przykład: <prompt → oczekiwane vs faktyczne, albo "brak">
   Priorytet zgłaszającego: <nice-to-have / co tydzień / codziennie blokuje>
   Wersja pluginu: <z .claude-plugin/plugin.json w katalogu pluginu, jeśli dostępny — inaczej pomiń>
   ```

4. **Optional ticket** — ONLY when the user explicitly asks to file it as a Jira ticket AND write tools are available: follow the standard flow — full dry-run preview, explicit confirmation, then ONE `create_issue` to the project the user names. No exceptions to the preview→confirm rule for "internal" tickets. (The server adds the `ai-generated` label automatically.)

Never send anything anywhere yourself — the Slack message is handed to the user to paste.
