---
name: find-bug
description: Semantic bug lookup - the user describes a problem in their own words and this skill finds the matching Jira bug(s), their status and deployment environment. Also handles "does such a bug already exist?" (dedup before reporting) and "list open bugs about X". Use for questions like "is the problem with X already fixed", "is the bug with Y fixed on UAT", "find a bug about...".
---

Find the bug the user means. Respond in the user's language. The description: $ARGUMENTS

## Steps

1. **Extract 2–4 keywords** from the description — technical nouns beat verbs. IMPORTANT: search each keyword in both English AND its Polish equivalent, because tickets are written in both languages (e.g. for "notifications", "counter", "sharing" also query the matching Polish terms).

2. **Search per variant** with `search_issues`, one query per keyword (don't AND them together):
   `project = <PROJECT> AND issuetype = Bug AND text ~ "<keyword>" ORDER BY updated DESC`
   Use `defaultProject` from the config when the user didn't name one. Collect and dedupe candidates across queries.

3. **Judge the match yourself** — compare titles against the user's description.
   - Confident single match → `get_issue` on it and answer: status, deployment environment (check labels like UAT/PROD, `fixVersions`, and the latest comments for deploy mentions), assignee, link.
   - No confident match → show the top 3 candidates (key, title, status) with an explicit disclaimer that none is a sure match.
   - Zero candidates → say so and suggest different keywords.

## Variants

- **"Does such a bug already exist?"** (dedup before filing): same search; answer explicitly "exists: KEY (status)" or "not found — you can report it", listing near-matches.
- **"List open bugs about X"**: `project = <PROJECT> AND issuetype = Bug AND text ~ "X" AND status in ("To Do", "In Progress", "Code Review")` (status list from the project profile when available; add "To Fix" if the profile has it). Summarize each bug in one line — goal: a quick "what's already reported" overview.
