---
name: find-bug
description: Semantic bug lookup - the user describes a problem in their own words and this skill finds the matching Jira bug(s), their status and deployment environment. Also handles "czy taki bug już istnieje?" (dedup before reporting) and "wypisz otwarte bugi dotyczące X". Use for questions like "czy problem z X jest już naprawiony", "is the bug with Y fixed on UAT", "znajdź buga o...".
---

Find the bug the user means. Respond in the user's language. The description: $ARGUMENTS

## Steps

1. **Extract 2–4 keywords** from the description — technical nouns beat verbs. IMPORTANT: prepare both Polish AND English variants (tickets are written in both), e.g. "powiadomienia/notifications", "licznik/counter", "udostępnianie/sharing".

2. **Search per variant** with `search_issues`, one query per keyword (don't AND them together):
   `project = <PROJECT> AND issuetype = Bug AND text ~ "<keyword>" ORDER BY updated DESC`
   Use `defaultProject` from the config when the user didn't name one. Collect and dedupe candidates across queries.

3. **Judge the match yourself** — compare titles against the user's description.
   - Confident single match → `get_issue` on it and answer: status, deployment environment (check labels like UAT/PROD, `fixVersions`, and the latest comments for deploy mentions), assignee, link.
   - No confident match → show the top 3 candidates (key, title, status) with an explicit disclaimer that none is a sure match.
   - Zero candidates → say so and suggest different keywords.

## Variants

- **"Czy taki bug już istnieje?"** (dedup before filing): same search; answer explicitly "istnieje: KEY (status)" or "nie znalazłem — można zgłaszać", listing near-matches.
- **"Wypisz otwarte bugi dotyczące X"**: `project = <PROJECT> AND issuetype = Bug AND text ~ "X" AND status in ("To Do", "In Progress", "Code Review")` (status list from the project profile when available; add "To Fix" if the profile has it). Summarize each bug in one line — goal: a quick "what's already reported" overview.
