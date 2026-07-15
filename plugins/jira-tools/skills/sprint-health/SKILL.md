---
name: sprint-health
description: Five-section health report of the active sprint - stalled tasks, fresh comments on unfinished work, On Hold moves, hygiene gaps (no description/labels/component), what reached Done yesterday. Use when the user asks "/sprint-health", "jak wygląda sprint", "raport sprintu", "sprint status report".
---

Produce the active-sprint health report. Respond in the user's language. Arguments (optional board name/id): $ARGUMENTS

## Setup

1. Resolve the board: argument → board id or name (match via `list_boards`); no argument → the `boardId` from the project profile of `defaultProject` in `~/.config/jira-tools/config.json`; if still unknown, call `list_boards` and ask the user.
2. `get_active_sprint` for the board (no active sprint → report that and stop).
3. `get_sprint_issues` for the sprint — this is the base list. Take status names from the project profile when available (fallback: To Do, To Fix, In Progress, Code Review, Dev Done, On Hold, Ready for QA, QA, Done).
4. Business days = Mon–Fri, holidays ignored. "3 business days back" from Monday reaches Wed–Fri of the previous week. Compute the cutoff date first and reuse it.

## Report — exactly five sections

**(a) Bez ruchu ≥ 3 dni robocze** — issues NOT in the first column (To Do) and NOT Done whose `updated` is older than the cutoff. For each candidate verify with `get_issue_changelog` that the last status change is also older (a comment bumps `updated` but is still "ruch" — count any update as movement; the changelog check is for reporting how long it sits in the status). List: key, status, days stuck, assignee.

**(b) Nowe komentarze w niedokończonych** — issues not in Done with comments from the last 3 calendar days: `search_issues` with `sprint = <id> AND status != Done AND updated >= -3d`, then `get_issue` on candidates and check comment dates. For each: key + ONE-sentence summary of what the recent comments say.

**(c) Przeniesione na On Hold** — issues currently in On Hold: for each, `get_issue` and quote the most recent comment (author, date) as the likely reason.

**(d) Braki higieny** — `search_issues` with `sprint = <id> AND (description is EMPTY OR labels is EMPTY OR component is EMPTY)`; list key + which of the three is missing.

**(e) Done wczoraj** — `search_issues` with `sprint = <id> AND status changed to Done after startOfDay(-1d) before startOfDay()`.

Keep each section to compact bullet lines; write "brak" when a section is empty. Start the report with the sprint header (name, dates, goal) from `get_active_sprint`.
