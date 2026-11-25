---
name: test-cases
description: Zephyr test management - write test cases (Zephyr "Test" issues with steps) from a story's acceptance criteria or the user's description, put them into a test cycle, and record results (PASS/FAIL) - ALWAYS with a dry-run preview and explicit user confirmation before any write. Use when the user says "/test-cases", "write test cases for PROJ-12", "create tests in Zephyr", "create a test cycle", "add these tests to the cycle", "mark PROJ-30 as passed", "how is the test cycle going".
---

Manage Zephyr test cases and test runs. Respond in the user's language; test content (titles, preconditions, steps) follows the `language` from `~/.config/jira-tools/config.json`. Request: $ARGUMENTS

## GOLDEN RULE — test what was specified, do not invent requirements

- Every expected result comes from the story's acceptance criteria, its description, or the user's words. If a criterion does not say what happens, you do not know it — ask.
- You may: split one criterion into a positive and a negative test when the criterion itself names both outcomes, write the steps as concrete user actions, and reuse the same preconditions across tests.
- You may not: add rules, limits, error messages or edge cases that nobody stated. Missing test data or an unclear expected result → one round of questions (AskUserQuestion), or `(to be filled in)` when the user skips it.

## Hard safety rules — no exceptions

- **NEVER call `create_test_cases`, `create_test_cycle`, `add_tests_to_cycle` or `set_execution_status` before the user explicitly confirms the preview** — even when they say "without asking".
- **Write exactly the previewed set**: test cases via ONE `create_test_cases` call (max 25 per call); results via one `set_execution_status` call per status.
- **STOP on an error.** Relay per-item failures verbatim and never blindly retry. Before a retry, check with `search_issues` or `search_test_executions` what already exists.
- Never use `allow_duplicate` unless the user explicitly says the duplicate is intended. If the session budget is exhausted, relay it and STOP.

## A. Write test cases

1. **Source**: a story key → `get_issue` (description, acceptance criteria); several keys or a range → `get_issue` with `keys`; otherwise the user's own description. Project = the story's project, else the argument, else `defaultProject`.
2. **Existing tests**: `search_issues` with `issuetype = Test AND issue in linkedIssues(<STORY>)`, and `project = <P> AND issuetype = Test AND summary ~ "<keyword>"` for the main keywords. Show what already exists and plan only what is missing.
3. **Draft**: one test per criterion or scenario. Each test: a title (`<feature>: <behaviour>`), preconditions in the description (Markdown), steps with action / test data / expected result. Keep 2–8 steps per test.
4. **DRY-RUN (mandatory)** — a normal chat message, one section per test:

   ```markdown
   ### 1/3 · Login: valid e-mail and password
   Project: PROJ · Labels: — · Components: — · Covers: PROJ-12 (AC 1)
   Preconditions: the user is logged out.

   | # | Action | Test data | Expected result |
   | - | ------ | --------- | --------------- |
   | 1 | Open the app | — | The login form is shown |
   | 2 | Type the e-mail and password, tap Log in | demo@example.com | The dashboard opens |
   ```

   Then AskUserQuestion with SHORT questions (refer to the preview, never paste it into the dialog): create them? link them to the story ("Relates")? put them into a cycle (an existing one from `list_test_cycles`, a new one, or none)? Over 10 tests → say the exact count in the question.
5. **Create** after confirmation: ONE `create_test_cases` call. Then, when chosen: `link_issues` (`from` = the story, `to` = the new keys) and the cycle part (B). Report every key + URL and every per-item error. A test with a failed step → offer `add_test_steps` for the missing steps only.

## B. Build a test cycle (test plan)

1. `list_test_cycles` for the project. Reuse a cycle when the user names one. A new cycle needs: name, version (default "Unscheduled"), environment and build when the user gives them, dates as YYYY-MM-DD. Ask for the name when it is missing — do not make one up.
2. Preview in one message: the cycle (new or existing, with id), the folder (if any — folder ids come from `list_test_cycles` with `cycle_id`), and the list of test keys. Confirm.
3. `create_test_cycle` (only for a new one), then `add_tests_to_cycle` with at most 50 keys per call. Relay the execution ids and the skipped tests.

## C. Record results

1. Map what the user reports ("PROJ-30 passed, PROJ-31 failed at step 2") to executions: `search_test_executions` with `cycleId = <id> AND issue in (PROJ-30, PROJ-31)`. Ask which cycle when it is not clear. One test in several folders → ask which one.
2. Preview one line per execution: `#<id> PROJ-31 · <cycle> / <folder> · UNEXECUTED → FAIL · comment: "<user's words>"`. Confirm.
3. One `set_execution_status` call per status. A comment carries the user's words only. Without a comment the existing comment stays.

## D. Progress (read only, no confirmation needed)

`list_test_cycles` (all cycles, or `cycle_id` for status counts and folders), `search_test_executions` for the details (e.g. `cycleId = 70 AND executionStatus = FAIL`), `get_test_case` for the steps and the history of one test.

## Summary

Created keys with links, links made, cycle id and execution ids, statuses set, anything skipped or failed. If a test has `(to be filled in)`, remind the user to complete it.
