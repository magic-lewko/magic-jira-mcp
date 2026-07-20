# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Hard rules

- **Never add Claude as co-author.** No `Co-Authored-By: Claude ...` trailers in commits, no "Generated with Claude Code" footers in PR bodies — anywhere in this repo.
- **Never commit or push without the user's explicit decision.** Prepare changes, summarize the pending diff, and wait for the go-ahead; each approval covers only that one commit.
- **SPEC.md is the source of truth.** Build exactly what it describes; when something is unclear, ask before implementing. Do not add features beyond the spec.
- **Never write to stdout in MCP server code** (no `console.log`) — stdout is the stdio protocol transport and any stray write kills the connection. Debug output goes to stderr only, behind `JIRA_DEBUG=1`.
- **Full anonymization.** No company-identifying data anywhere in the repo: no tokens, passwords, production Jira URL, company name, real production project keys, product names, or internal branch names. Use neutral `PROJ-n` keys and `https://jira.example.pl` in examples and tests. The only sanctioned real identifiers are the `DC` test sandbox names. Company-specific data enters only via user-local config or args files (git-ignored).

## What this is

A private (unpublished) Claude Code plugin for the whole company (different teams, different boards), integrating a self-hosted **Jira Server** (not Cloud!) via REST API v2 with `Authorization: Bearer <PAT>`. Agile API (boards/sprints) lives under `/rest/agile/1.0/`.

Monorepo = marketplace + plugin: the repo root is a plugin marketplace (`.claude-plugin/marketplace.json`) pointing at `plugins/jira-tools/`, which contains the actual plugin:

- MCP server: stdio transport, server name `jira`, entry `plugins/jira-tools/servers/jira-mcp.mjs`, source split into `plugins/jira-tools/src/` — `jira-client.mjs` (all HTTP), `config.mjs`, `format.mjs`, `tools/` (one file = one MCP tool).
- Skills (slash commands) in `plugins/jira-tools/skills/*/SKILL.md`.
- `references/` — generic reference scripts showing the proven fetch/auth/formatting patterns, key-range expansion (`PROJ-98..111`), pagination, and dry-run-before-write. Company-specific inputs (plans, rename maps, refs) come from args/JSON files, never hardcoded. Reuse their logic in the MCP server.

## Key constraints

- Node.js >= 20, pure ESM (`.mjs`). Runtime deps: only `@modelcontextprotocol/sdk` and `zod` (tool input validation). Tests use `node:test`, no frameworks.
- Tools return concise formatted text (never raw JSON), optimized for LLM context. Fetch minimal fields by default; `description` and comments only in `get_issue`.
- Write tools (`create_issue`, `add_comment`, `transition_issue`, `assign_to_epic`) are registered ONLY when `JIRA_ALLOW_WRITE=true`. Default is read-only. Server-side write rails (code, not skill instructions): one issue per call, session write budget (default 10 creates / 30 writes, `writeBudget` in config or `JIRA_WRITE_BUDGET_*` env), duplicate guard on `create_issue` (`allow_duplicate=true` only after explicit user confirmation), and a per-project opt-in — writes hit only projects with `projects.KEY.allowWrite: true` (or `writeProjects`/`JIRA_WRITE_PROJECTS`), checked per call without restart. `/jira-setup` asks for the global mode, `/jira-config` asks per project. A plugin-shipped PreToolUse hook (`hooks/guard-config.mjs`) forces a manual permission prompt for any `allowWrite` change in the user config (edits are simulated and value-compared). AI transparency: unless `aiLabel: false`, created issues get an `ai-generated` label and comments a signature suffix — enforced in code.
- Config precedence (first wins): env vars (`JIRA_SERVER`, `JIRA_TOKEN`, `JIRA_ALLOW_WRITE`, `JIRA_DEFAULT_PROJECT`, `JIRA_LANG`) → `~/.config/jira-tools/config.json` → no config: server still starts, every tool returns "run /jira-tools:jira-setup".
- Per-user project profiles live in the config's `projects` section (statuses, boardId, epic link field, components), populated by the `/jira-config <project>` skill — tools read the profile instead of guessing status names. Default status list (fallback when no profile): To Do, To Fix, In Progress, Code Review, Dev Done, On Hold, Ready for QA, QA, Done. Business days = Mon–Fri, holidays ignored.
- All HTTP goes through a single `jiraFetch(path, opts)`: auth, 30 s timeout, error mapping in one place (401 → token expired + how to generate a new PAT; 404 → "KEY not found"; other → status + first 300 chars of body). Never log the token.
- `search_issues` paginates via `startAt`; on truncation append `"(pokazano X z Y — zawęź JQL lub zwiększ max_results)"`.
- Code and comments in English; end-user-facing messages follow `JIRA_LANG` (pl/en).

## Branching

`develop` (day-to-day work) → `uat` (stage) → `main` (prod). Commit to `develop`; promotions to `uat`/`main` happen by merge on the user's call.

## Commands

- `npm test` — unit tests (`node:test`, mocked `globalThis.fetch`).
- `node --test tests/unit/<file>.test.mjs` — run a single test file.
- `npm run test:integration` — opt-in, strictly read-only; runs only with `JIRA_TEST_SERVER` + `JIRA_TEST_TOKEN` set (`JIRA_TEST_ISSUE` for the get_issue case).
- `claude plugin validate` — must pass, together with `npm test`, before a phase is considered done.

## Local testing workflow

Install from a local path: `/plugin marketplace add <path-to-this-repo>`, then `/plugin install jira-tools@<marketplace-name>` — but always in a **separate test directory/session, never inside this repo itself** (a local-scope install here pollutes `.claude/settings.local.json`). `SKILL.md` changes are picked up live, but changes to `.mcp.json` or server code require `/reload-plugins` (or a session restart) — don't mistake a stale server for a broken fix. If the server won't connect after a change, check for stray stdout writes first (`/mcp` shows errors).

## Phasing

Iterate phase by phase, never everything at once. Phase 1 (read-only MVP: config + client + read tools + skills `/jira-setup`, `/jira-config`, `/get-tasks`, `/sprint-health`, `/check-stories`, `/find-bug` + unit tests + README) → tests green → only then Phase 2 (write tools behind the flag + `/create-task` with a mandatory dry-run preview before any `create_issue` call). The manual e2e checklist is in SPEC.md §8.3.

Test sandbox: Jira project `DC` (board "DC board", sprint "DC Sprint 1", sample keys DC-1/DC-16/DC-18) — manual write tests allowed there in Phase 2; automated integration tests stay read-only. The user's local `.env.local` (git-ignored) holds `VITE_JIRA_SERVER`/`VITE_JIRA_TOKEN` for the reference scripts and integration testing.
