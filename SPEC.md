# SPEC — Claude Code Plugin: integration with Jira Server (self-hosted)

> This document is the source of truth for the implementation. Build exactly what is described here.
> When something is unclear: ask before you implement. Do not add features beyond the specification.

## 1. Goal

An internal (private, unpublished) Claude Code plugin for the whole company — different teams,
different boards — integrating a self-hosted **Jira Server** (not Cloud!) via REST API v2
with **Bearer PAT** authorization. The repo is impersonal: zero company data (§10).

Two audiences:

- **Devs** — use it through Claude Code (slash commands + natural language via MCP).
- **PMs/analysts** — use the same MCP server through Claude Desktop / Cowork.

## 2. Technical context (fixed assumptions)

- Jira: self-hosted, e.g. `https://jira.example.pl` (URL is configurable, NEVER hardcoded).
- API: `GET/POST {JIRA_SERVER}/rest/api/2/...`, header `Authorization: Bearer <PAT>`.
- Agile API (sprints/boards): `{JIRA_SERVER}/rest/agile/1.0/...`.
- Runtime: Node.js >= 20, pure ESM (`.mjs`), **zero external runtime dependencies**
  besides `@modelcontextprotocol/sdk` and `zod` (tool parameter validation).

## 3. Repository structure (monorepo = marketplace + plugin)

```text
.
├── .claude-plugin/
│   └── marketplace.json          # marketplace "magic-jira-mcp" → ./plugins/jira-tools
├── plugins/
│   └── jira-tools/
│       ├── .claude-plugin/
│       │   └── plugin.json
│       ├── .mcp.json             # MCP server definition (stdio, ${CLAUDE_PLUGIN_ROOT})
│       ├── servers/
│       │   └── jira-mcp.mjs      # MCP server (single-file, self-contained after bundling)
│       ├── src/                  # server source code split into modules
│       │   ├── jira-client.mjs   # HTTP layer: auth, fetch, pagination, errors
│       │   ├── config.mjs        # config loading (env → file → error with instructions)
│       │   ├── format.mjs        # compact formatting of tickets to text
│       │   ├── zephyr.mjs        # shared Zephyr logic (project/version, Test type, statuses)
│       │   ├── project-rules.mjs # shared project rules stored in Jira (§5.2)
│       │   └── tools/            # one file = one MCP tool
│       ├── skills/               # one directory = one slash command
│       │   ├── jira-setup/  jira-config/  jira-update/  get-tasks/
│       │   ├── sprint-health/  check-stories/  find-bug/
│       │   └── create-task/  feedback/  test-cases/  project-rules/
│       ├── docs/use-cases.md     # prompt cheat sheet (STE)
│       └── README.md             # short pointer to the main README
├── scripts/
│   └── build.mjs                 # esbuild: bundles src/ → servers/jira-mcp.mjs (npm run build)
├── tests/
│   ├── unit/                     # tests with mocked fetch (node:test)
│   └── integration/              # read-only tests against a real Jira (opt-in via env)
├── SPEC.md                       # this file
└── CLAUDE.md                     # condensed rules for working on the repo
```

## 4. MCP server — tools

Transport: **stdio**. Server name: `jira`. All tools return **concise text**
(not raw JSON), optimized for the LLM context. Every tool validates input with zod.

### 4.1 Read (priority — phase 1)

| Tool                  | Parameters                                                                                            | Description                                                                                                                                                                       |
| --------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `search_issues`       | `jql` (string, required), `max_results` (int, default 30, max 100), `fields` (string[], optional)     | Runs any JQL. The foundation — Claude composes the JQL itself for natural-language questions. Returns a compact list: key, type, status, priority, assignee, title, labels, updated. With `fields`, an "Extra fields" block follows (CSV-style exports): top-level `id`/`key`/`self` are allowed, `created`/`updated` come back with time of day, objects are flattened to name/key (users → username, no avatar noise), and field ids Jira did not return are listed. |
| `get_issue`           | `key` or `keys` (also handle the range `PROJ-98..111`), `all_comments?`                               | Full detail: description, comments (author+date), attachments (names+URL), components, epic/parent. Context savings: by default the 5 most recent comments and description up to 4000 chars with an explicit truncation note; `all_comments=true` lifts the limits.  |
| `list_boards`         | `project` (optional)                                                                                 | Agile boards (needed to find a sprint).                                                                                                                                          |
| `get_active_sprint`   | `board_id`                                                                                            | Active sprint of a board: name, dates, goal.                                                                                                                                    |
| `get_sprint_issues`   | `sprint_id` or (`board_id` + `sprint_name`)                                                          | Sprint tasks, compact.                                                                                                                                                          |
| `get_epic_status`     | `epic_key`                                                                                            | Counts the epic's children per status + a list of open ones. The Epic Link field differs per instance — take it from the project profile (§5.1) or auto-detect via `/rest/api/2/field`.         |
| `get_issue_changelog` | `key`                                                                                                 | History of status changes with dates (needed for "what changed status to done yesterday" and "no movement for 3 days").                                                                        |
| `get_current_user`    | —                                                                                                     | Verifies the connection and token: logged-in user (`/rest/api/2/myself`). The final test in `/jira-setup` ("Logged in as X").                                                |
| `get_project_config`  | `project`, `board_id?`                                                                                | Project metadata for the profile (§5.1): boards, columns→statuses, components, issue types, auto-detection of the Epic Link field. Backend for the `/jira-config` skill.                              |
| `get_project_rules`   | `project`                                                                                             | The project's shared rules stored in Jira (§5.2): "assignee → component" per issue type, plus who changed them last. Used by the `/create-task` preview to show the component a rule adds. |
| `get_version`         | —                                                                                                     | Running server version + health (Node, config loaded, write budget) and the update-feed line (§4.5): newer release available / up to date / check failed. Works without a config. |
| `download_update`     | `force?`                                                                                              | Downloads the newest Claude Desktop bundle: reads `releases/latest.json` from `main`, saves `releases/jira-tools.mcpb` as `~/Downloads/jira-tools-<version>.mcpb` after a SHA-256 check and explains the double-click install (§4.5). Skips the download when already on the latest unless `force=true`. In Claude Code (no `JIRA_CLIENT=desktop`) it returns the marketplace update commands instead. Works without a config. |

### 4.2 Write (phase 2 — behind a flag)

| Tool               | Parameters                                                                                              | Description                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `create_issue`     | `project`, `issue_type` (role `epic/story/task/subtask/bug` or exact name), `summary`, `description` (Markdown → wiki), `description_format?`, `components[]`, `labels[]`, `assignee?`, `epic_key?`, `epic_name?`, `parent?`, `story_points?`, `sprint_id?`, `backlog?`, `steps_to_reproduce[]?`, `actual_result?`, `expected_result?`, `custom_template?`, `allow_duplicate?` | Creates ONE ticket. Returns key + URL. A role resolves to the project's own type name via the profile's `issueTypeRoles`. `parent` is required for a sub-task type (validated: the type must be a sub-task type and the parent must not be one). `epic_name` defaults to the summary on an epic. Story Points resolve by field name only. `sprint_id` (from `get_active_sprint`) places the ticket in the sprint, `backlog=true` leaves it in the backlog — one of them is required (safeguard 5); custom fields come from the profile or auto-detection. A bug follows the standard bug template (safeguard 6): the server writes the description from `steps_to_reproduce`, `actual_result` and `expected_result`, and a `description` lands below it. |
| `create_issues`    | `project`, `items[]` (each: the `create_issue` fields minus `project`; max 50)                            | Creates up to 50 tickets in ONE request (`POST /rest/api/2/issue/bulk`) — the sanctioned path for a breakdown. Same per-item rules as `create_issue`. The whole batch must fit the session budget or nothing is created; every item passes the duplicate guard (against Jira and within the batch). Parents must exist before children: epic → stories → sub-tasks in a second call. Returns keys and per-item errors. |
| `add_comment`      | `key`, `body`                                                                                           | Adds a comment.                                                                                                         |
| `transition_issue` | `key`, `transition_name`                                                                                | Status change (first fetch the available transitions, match by name case-insensitively, and if none match — list the available ones). |
| `update_issue`     | `key`, `summary?`, `assignee?`, `labels?`, `add_labels?`, `components?`, `priority?`, `description?` (Markdown → wiki), `description_format?`, `story_points?`, `sprint_id?`, `epic_key?`, `epic_name?` | Edits an existing issue (whitelist of fields). `labels`/`components` replace the lists, `add_labels` appends (read-modify-write). Custom fields (Story Points, Sprint, Epic Link, Epic Name) resolve as in `create_issue`. Status → `transition_issue`; a sub-task's parent is fixed at creation. |
| `add_attachment`   | `key`, `path`, `filename?`                                                                              | Uploads ONE file from disk as an attachment (multipart + `X-Atlassian-Token: no-check`, 10 MB limit). The path must be explicitly provided by the user — no globs. **An image pasted into the conversation is not a file**: it only reaches the model's context, and the tools do not have access to its bytes (confirmed in the documentation), so it must first be saved to disk. |
| `link_issues`      | `from`, `to[]` (ranges, max 20), `type?` (default "Relates")                                            | Creates links between issues (POST `/rest/api/2/issueLink`). `from` is the source of the link: for "Blocks", from blocks each key in `to`. Note Jira's inverted field names — the source goes into `inwardIssue`, the target into `outwardIssue` (verified on Jira Server 8.21.0). The type is matched case-insensitively to the instance's types; if none match — a list of available ones. `create-task` proposes linking the per-platform tickets of a single story. |
| `assign_to_epic`   | `epic_key`, `keys[]` (ranges `PROJ-98..111`, max 20)                                                    | Attaches existing tasks to an epic (Agile API). Analyst use case: "stories from a release without an epic → attach them under the epic". Each task counts against the session budget. |
| `create_sprint`    | `board_id`, `name` (max 30 chars, Jira limit), `goal?`, `start_date?` + `end_date?` (ISO 8601 date-time, together), `allow_duplicate?` | Creates ONE future sprint on a Scrum board (`POST /rest/agile/1.0/sprint`) — it lands in the backlog; starting it stays a manual step in Jira. Returns the sprint id for `sprint_id` in `create_issue`/`update_issue`. Refuses Kanban boards. Duplicate guard: an active or future sprint with the same name (case-insensitive) on the board blocks creation unless `allow_duplicate=true` after explicit user confirmation. Counts against the session budget. Needs the Manage Sprints permission. |
| `set_project_rules` | `project`, `component_rules[]` (max 30; each: `component`, `assignees[]` (usernames or names, max 30), `issue_types?` (roles or names; omit = every type)), `dry_run?` | REPLACES the "assignee → component" rules of the project, stored in Jira as the project property `jira-tools` (§5.2). Every component and issue type must exist in the project, and every person must match exactly one active user (an exact username wins, otherwise the user search must return one hit). One problem → nothing is saved, all problems listed. `dry_run=true` checks everything and saves nothing (the preview). Keeps the other keys of the property and records `updatedBy`/`updatedAt`. Needs the Administer Projects permission (a 403 gives a clear message). Counts against the session budget. |

**Write safety principle:** there is no "write mode" — all tools (read and write)
are always registered, and writing works by default. The safeguards protect against an AI mistake,
not against the user. Without a config, every tool returns setup instructions, so nothing
will be written before configuration.

**Write safeguards (enforced in the server code, not in skill instructions):**

1. **Explicit batches, not loops** — `create_issue` creates exactly one ticket. A real
   breakdown goes through `create_issues` (max 50 per call, one request): the whole batch
   must fit the session budget or nothing is created, every item passes the duplicate guard
   (against Jira and within the batch), and the skills' dry-run covers the whole set at once.
   Loops of single creates remain unsanctioned.
2. **Per-session write budget** — a counter in the server process: by default 100× `create_issue`
   and 300 write operations total. Once exceeded, every operation returns a readable refusal
   (reset = server restart / `/reload-plugins`). Configuration: the `writeBudget` field
   (`{"creates": n, "total": m}`) or the env vars `JIRA_WRITE_BUDGET_CREATES` /
   `JIRA_WRITE_BUDGET_TOTAL`. Purpose: a hard stop for an uncontrolled creation loop.
3. **Duplicate guard** — before creating, `create_issue` looks for an open task
   with the same (normalized) title in the project — scoped to the parent for a sub-task,
   because sub-task titles legitimately repeat across stories; a hit ⇒ refusal pointing to
   the existing key, unless `allow_duplicate=true` is explicitly passed (only after
   user confirmation). Limitation: it relies on Jira's text index,
   which updates with a delay for freshly created tickets — two identical
   creations within seconds of each other may both go through. The hard protection against a loop is the
   session budget (point 2), not this guard.
4. **Mandatory dry-run in `/create-task`** — a full preview and confirmation before each
   creation; plus Claude Code's own permission prompts on every tool call.
5. **The user chooses the sprint** — `create_issue` and every `create_issues` item need
   `sprint_id` (the user chose the active sprint) or `backlog=true` (the user chose the backlog);
   both at once is a contradiction. Epics and sub-tasks are exempt (a sub-task follows its
   parent). Without a choice the tool refuses before any request and tells the agent to ask:
   the agent must never pick the sprint for the user. `/create-task` asks it in the
   confirmation dialog, with the name of the active sprint.
6. **Standard bug template** — a bug (the `bug` role, the profile's mapped bug type, or a type
   name with "bug") needs a title `[label] title` and at least one of `steps_to_reproduce`,
   `actual_result`, `expected_result`. The server writes the description in one fixed layout:
   bold headers, a blank line before each section, the steps as a numbered list, and
   `(to be filled in)` for a skipped section:

   ```
   *Steps to reproduce:*
   # Open the profile page
   # Click Save

   *Actual result:*
   Nothing happens

   *Expected result:*
   The new name is saved
   ```

   `custom_template=true` turns this off, only when the user explicitly asked for another
   template; the `description` is then used as written. In `create_issues` the rails 5 and 6
   are checked for every item first: one refused item stops the whole batch before any request.

**AI content marking (transparency, always on):** `create_issue` adds, in code, the
label `ai-generated` (filterable: `labels = ai-generated`), and `add_comment` appends
a fixed signature `_(ai-generated · jira-tools)_` — Jira comments are not labeled.

**Shared project rules (§5.2, applied in code):** when `create_issue`, `create_issues`,
`create_test_cases` or `update_issue` (assignee change) sets an assignee, the tool reads the project's
rules and adds the matching component. Rules only add: given or current components stay, nothing is
removed, and the result names the added component ("added by the project rule"). The rules are read
only when an assignee is set (one read per call). A failed read never blocks the write: the tool writes
without the rule component and says so.

### 4.3 Common requirements

- **Pagination:** `search_issues` handles `startAt`; when results are truncated append
  `"(showing X of Y — narrow the JQL or raise max_results)"` at the end.
- **Context savings:** by default fetch the minimal set of fields; `description` and
  `comment` only in `get_issue`.
- **Errors:** 401 → message "token expired/invalid + how to generate a new PAT";
  404 → "KEY not found"; other → status + the first 300 chars of the body. Never log the token.
- **Timeout:** 30 s per request, a readable message when exceeded.

### 4.4 Description formatting

Jira Server renders wiki markup, not Markdown. `create_issue`, `create_issues` and
`update_issue` convert `description` from Markdown to wiki markup in code
(`wiki-markup.mjs`): headings, bold/italic/strikethrough, inline and fenced code, nested
bullet and numbered lists, checklists (`- [ ]` → `(x)`, `- [x]` → `(/)`), tables, links,
blockquotes and horizontal rules. It is deliberately the subset the skills emit, not a
general converter. A caller that already holds wiki markup passes
`description_format="wiki"` to skip the conversion.

### 4.5 Update channel (Claude Desktop bundle)

A sideloaded `.mcpb` never updates itself (only extensions from Anthropic's directory do, and
the MCPB manifest has no update field), so the server carries its own update check:

- `npm run build:mcpb` publishes `releases/jira-tools.mcpb` (fixed name) and `releases/latest.json`
  (`{version, file, sha256, size}`). Both are committed with the release and promoted to `main`.
- `src/update.mjs` reads `https://raw.githubusercontent.com/magic-lewko/magic-jira-mcp/main/releases/`.
  `get_version` ends with one line: newer release available (plus how to get it), up to date, ahead
  of the release, or why the check failed. 3 s timeout, never throws, offline-safe.
  `JIRA_NO_UPDATE_CHECK=1` silences it (unit tests set it).
- `download_update` fetches the bundle (60 s timeout, 25 MB cap), verifies the SHA-256 from the feed
  and only then writes `~/Downloads/jira-tools-<version>.mcpb` (`JIRA_DOWNLOAD_DIR` overrides the
  folder, temp folder when Downloads does not exist). Installing stays a manual double-click; the tool
  never touches Claude Desktop's extension folder.
- The bundle manifest sets `JIRA_CLIENT=desktop`. Without it (Claude Code plugin) both tools point to
  `/plugin marketplace update magic-jira-mcp` + `/plugin install jira-tools@magic-jira-mcp` + `/jira-update`.

### 4.6 Zephyr Squad Server (test management)

Teams that keep test cases in Zephyr Squad Server (the Jira Server plugin `com.thed.zephyr.je`) use the
same server and the same Bearer PAT: the Zephyr REST API lives under `{JIRA_SERVER}/rest/zapi/latest/`
and goes through `jiraFetch` like every other call. Zephyr sometimes reports a failure with HTTP 200 and an
`errorDesc`/`errorId: "ERROR"` or `error` body; the client turns that into a normal error. A test case is a
Jira issue of the Zephyr type "Test" (found by name, else by the Zephyr description of the type); a test
cycle is a test run inside a project version (`-1` = "Unscheduled"); an execution is one test placed in a
cycle (optionally in a folder of the cycle) with a status.

Read:

| Tool                     | Parameters                                   | Description |
| ------------------------ | -------------------------------------------- | ----------- |
| `list_test_cycles`       | `project`, `version?`, `cycle_id?`           | Cycles of a project (all versions, or one version by name), newest first: id, name, version, environment, build, dates, executed/total and status counts (Zephyr fills the totals only with `expand=executionSummaries`; folders included). With `cycle_id`: status counts from a ZQL read of all its executions (cap 2000) and per-folder progress with folder ids. |
| `search_test_executions` | `zql`, `max_results?` (default 50, max 500)  | ZQL search (`/zql/executeSearch`, paged by absolute `offset`): one line per execution — execution id, status, test key + title, cycle / folder, version, executed by + date, defects, comment — plus status counts and the truncation note `(showing X of Y — narrow the ZQL or raise max_results)`. |
| `get_test_case`          | `key`                                        | One test: meta, description (capped at 4000 chars), all steps (action / test data / expected result) and its last 20 executions. Refuses an issue that is not a Zephyr test. |

Write (same rails as §4.2: session budget, duplicate guard, AI marking):

| Tool                   | Parameters                                                                                       | Description |
| ---------------------- | ------------------------------------------------------------------------------------------------ | ----------- |
| `create_test_cases`    | `project`, `items[]` (1–25; each: `summary`, `description?` (Markdown → wiki), `description_format?`, `steps[]?` (max 30: `step`, `data?`, `result?`), `components?`, `labels?`, `assignee?`, `allow_duplicate?`) | Creates the tests in ONE `/rest/api/2/issue/bulk` request through the shared issue builder (so the `ai-generated` label is added in code), then posts each test's steps (`POST /teststep/{issueId}`) in order. The whole batch — tests plus steps — must fit the session budget or nothing is created; every item passes the duplicate guard (Jira + within the batch). A failing step stops that test's steps and is reported with the number of steps added. Refuses a project without the Zephyr Test type. |
| `add_test_steps`       | `key`, `steps[]` (1–30)                                                                          | Appends steps to ONE existing test. Refuses other issue types. Each step counts against the budget. |
| `create_test_cycle`    | `project`, `name`, `version?` (default "Unscheduled"), `description?`, `build?`, `environment?`, `start_date?`, `end_date?` (YYYY-MM-DD → Zephyr's `d/MMM/yy`), `allow_duplicate?` | Creates ONE cycle (`POST /cycle`) and returns its id. Duplicate guard: a cycle with the same name (case-insensitive) in the same version blocks creation unless `allow_duplicate=true` after explicit user confirmation. The description always ends with the AI signature. |
| `add_tests_to_cycle`   | `cycle_id`, `keys[]` (ranges, max 50), `folder_id?`                                              | Puts tests into a cycle (or one of its folders) with one synchronous `POST /execution` per test, so every test gets its execution id back (the async `addTestsToCycle` job gives none). All keys are checked first: nothing is added when a key is unknown, not a Zephyr test, or from another project than the cycle. Tests already in the same cycle and folder are skipped, not duplicated. Each added test counts against the budget. |
| `set_execution_status` | `execution_ids[]` (1–50), `status`, `comment?`                                                   | Sets ONE status (matched case-insensitively against `/util/testExecutionStatus`, custom statuses included) on each execution (`PUT /execution/{id}/execute`, numeric status). A given comment replaces the execution comment and gets the AI signature; without a comment the existing comment stays untouched (an execution has a single comment field, so the signature is never written on its own). Each execution counts against the budget. |

## 5. Configuration

Load order (first wins):

1. Environment variables: `JIRA_SERVER`, `JIRA_TOKEN`, `JIRA_DEFAULT_PROJECT`, `JIRA_LANG`.
   In **Claude Desktop** (where the agent has no file access) this is the main path: the plugin
   declares `userConfig` (`jira_server`, `jira_token` + `sensitive`, `jira_language`,
   `jira_default_project`) in `plugin.json`, and `.mcp.json` maps them to those env vars (`${user_config.*}`).
   Desktop asks for them at install time — without a file. Unfilled fields (`default: ""` or
   an unsubstituted `${...}`) are ignored, so the fallback to a file (Claude Code) works.
2. The file `~/.config/jira-tools/config.json` (mode 600 on write) — written by
   `/jira-setup` in Claude Code; project profiles (§5.1) only via this path.
3. None → the server starts, but every tool returns the instruction: "run /jira-tools:jira-setup".

`JIRA_LANG` (`pl`/`en`) — the language of generated descriptions/AC when creating tickets. Does not affect reads.

**The token never enters the repo.** `.gitignore` must cover all config/env files.

### 5.1 Project profiles (per user)

Each user configures their own projects — there is no global default in the repo.
`config.json` contains a `projects` section: a profile per project, filled in automatically by
the `/jira-config <project>` skill (§6). Tools and skills read the profile instead of guessing
status and field names:

```json
{
  "server": "https://jira.example.pl",
  "token": "…",
  "language": "pl",
  "defaultProject": "DC",
  "projects": {
    "DC": {
      "boardId": 123,
      "boardName": "DC board",
      "statuses": ["To Do", "To Fix", "In Progress", "Code Review", "Dev Done", "On Hold", "Ready for QA", "QA", "Done"],
      "epicLinkField": "customfield_XXXXX",
      "sprintField": "customfield_XXXXX",
      "platforms": ["iOS", "Android", "Web", "Backend"],
      "titleConvention": "[<Platform>] <title>",
      "taskTemplate": {
        "story": "Business context:\n…\n\nAcceptance criteria:\n- …",
        "task": "Context:\n…\n\nScope:\n…\n\nDefinition of Done:\n- …"
      },
      "components": ["Frontend", "Backend"],
      "issueTypes": ["Story", "Bug", "Task", "Sub-task"]
    }
  }
}
```

When there is no profile, the default status list applies (a template, to be overridden by the profile):
`To Do`, `To Fix`, `In Progress`, `Code Review`, `Dev Done`, `On Hold`, `Ready for QA`,
`QA`, `Done`. An additional fallback for unusual names: Jira's built-in `statusCategory`
(`new` / `indeterminate` / `done`).

### 5.2 Shared project rules (in Jira, per project)

Some conventions belong to the project, not to one user: "bugs assigned to the frontend developers
get the Frontend component". They are set once at the start of a project and again when a person
joins or leaves — usually by the tester or the PM, in plain words through `/project-rules`. They are
stored **in Jira**, as a project property (`/rest/api/2/project/{key}/properties/jira-tools`), so
everyone on the project gets the same rules without editing a local config, and no name enters the repo.
Reading needs only Browse Projects; saving needs Administer Projects. Jira has no screen for project
properties: they are read and changed only through jira-tools (`get_project_rules`, `set_project_rules`).

```json
{
  "componentRules": [
    { "component": "Frontend", "assignees": ["anowak", "bkowal"], "issueTypes": ["Bug"] },
    { "component": "Mobile", "assignees": ["dzielinski"] }
  ],
  "updatedBy": "pm.user",
  "updatedAt": "2026-11-25T10:00:00.000Z"
}
```

`assignees` are Jira usernames, `issueTypes` are the project's type names (absent = every type). Matching
is case-insensitive. A person in two rules gets both components. A value that does not match this schema
is ignored as a whole (never applied half-way) and reported. Limit: only jira-tools applies the rules —
an assignment made by hand in Jira adds no component.

## 6. Skills (slash commands)

Each skill = a directory with `SKILL.md` (frontmatter: `name`, `description` — the description must be
specific, since auto-invocation by the model depends on it).

- **`/jira-setup`** — interactive configuration: asks for the Jira URL, walks through generating
  a PAT (Profile → Personal Access Tokens), asks for the language (pl/en), the default project, writes
  to `~/.config/jira-tools/config.json` (chmod 600), and finally tests: `GET /rest/api/2/myself`
  and prints "Logged in as X".
- **`/jira-config <project>`** — fetches project metadata and writes the profile to the user's
  config (§5.1): the project's boards (`/rest/agile/1.0/board?projectKeyOrId=`), columns →
  statuses from the board configuration (`/rest/agile/1.0/board/{id}/configuration`), statuses per issue
  type (`/rest/api/2/project/{key}/statuses`), components and issue types
  (`/rest/api/2/project/{key}`), auto-detection of the Epic Link field (`/rest/api/2/field`, the field
  named "Epic Link"). When there are multiple boards it asks the user which is the default.
  At the end it prints a summary of the saved profile.
- **`/jira-update`** — reconciling the config with the schema after a plugin update (Claude Code):
  keeps `server` and `token`, removes fields from previous versions (e.g. `allowWrite`, `aiLabel`,
  `writeProjects`), refreshes project profiles, and backs up to `config.json.bak`. Does not touch
  Desktop (there the config goes through `userConfig`, §5).
- **`/get-tasks <project> [sprint] [tags:a,b,c]`** — my tasks in a project; with a sprint —
  narrowed to the sprint; with tags — filtered by labels. Under the hood, `search_issues` with JQL like
  `project = X AND assignee = currentUser() AND sprint = "..." AND labels in (...) ORDER BY status`.
- **`/sprint-health [board]`** — a report on the active sprint, sections:
  (a) tasks with no movement ≥3 business days (excluding To Do and Done — use changelog/updated),
  (b) non-Done with new comments from the last 3 days + a one-sentence summary of each,
  (c) moved to On Hold + the last comment,
  (d) hygiene gaps: no description / labels / component,
  (e) what moved to Done yesterday.
  Business days = Mon–Fri, holidays are ignored (e.g. on Monday "3 business days back"
  reaches Friday, Thursday and Wednesday). Take status names from the project profile (§5.1).
- **`/check-stories <project> [sprint]`** — user-story audit: no assigned sprint
  or no Azure number in the title (default regex `\[\d{6,}\]` — 6+ digits, e.g.
  `[642321] Missing parameters in the event…`; overridable per project via the
  `storyNumberPattern` field in the profile). Brackets that do not match the pattern — `[F]`, `[iOS]`, `[2024]` —
  do not count as a number and are reported separately; we do not validate the number's
  correctness in Azure. Also works on an explicit list of keys (e.g. a release range from Notion).
  Result: a KEY | problem table.
- **`/find-bug <verbal description>`** — semantic search: extract 2-4 keywords
  (PL and EN!), `search_issues` with `text ~` for each variant, gather candidates, assess the
  match, and for the best one give status + which environment (fixVersions/labels/comments)
  and a link. When there is no confident hit — show the top 3 candidates with a caveat. Also handle the
  variant "does such a bug already exist?" (deduplication) and "list open bugs about X
  in the To Do/In Progress/Code Review columns".
- **`/feedback [description]`** — a mini-interview about an idea/problem with the plugin (what, why, how it hurts,
  example) → a ready-made message to paste into Slack for the plugin maintainers; optionally
  a ticket via `create_issue` (full dry-run, no exceptions). The skill sends nothing by itself.
- **`/test-cases [story key | description]`** — Zephyr test management (§4.6): drafts test cases
  from a story's acceptance criteria or the user's words (expected results only from what was
  specified), checks existing tests first, shows a **mandatory dry-run** (one table of steps per test),
  then ONE `create_test_cases` call, optional `link_issues` to the story, and the cycle part
  (`create_test_cycle` / `add_tests_to_cycle`). Recording results maps the user's report to execution
  ids via ZQL, previews the status changes and calls `set_execution_status` once per status.
- **`/project-rules [project]`** — saves or shows the shared project rules (§5.2) from plain words, e.g.
  "if a bug is assigned to Nowak or Kowalski, add the Frontend component". Reads the current rules,
  merges the change (a person joins or leaves, a new rule), previews the FULL list with
  `set_project_rules dry_run=true` (people resolved to usernames, ambiguous names asked back), and saves
  only after confirmation.
**Golden rule of write skills** (`/create-task`, `/feedback`, `/test-cases`): the agent **structures what the
user provided and asks about gaps — it never invents content**. An empty template section is a
signal to ask a question (and to gently push), not to fill it with a guess;
a deliberately omitted section gets a literal `(to be filled in)`. The template exists so
as to force the user to think, not to give the agent room to hallucinate.

Bugs use the standard bug template built into the server (§4.2 safeguard 6): `[label] title`,
**Steps to reproduce**, **Actual result**, **Expected result**. `/create-task` uses it for every bug
without asking. A `taskTemplate.bug` in the profile is only an alternative, used when the user asks
for another template (`custom_template=true`).

Description templates (`taskTemplate` per type) are configured by `/jira-config` in three ways:
**import from designated reference tickets** (recommended — e.g. `BUG - PROJ-99, TASK - PROJ-100`;
the skill reads them via `get_issue` and derives the section structure in the team's style), a custom
pasted template, or the skill's own proposal.

- **`/create-task <description>`** — (phase 2) creates tickets per platform. From the case description it generates:
  title, description, acceptance criteria (in the language from the config), a component per platform
  (iOS/Android/Web/Backend → separate tickets). **MANDATORY dry-run:** first list
  all tickets to be created as a preview, wait for the user's confirmation,
  and only then call `create_issue`. The confirmation always asks "active sprint «name» or backlog?"
  (the name comes from `get_active_sprint`), and a bug always uses the standard bug template
  (§4.2 safeguards 5 and 6).

## 7. Implementation rules (quality)

- Node `node:test` for tests, no frameworks.
- HTTP client: a single `jiraFetch(path, opts)` function — auth, timeout, error mapping in one place.
- Code and comments in English; end-user messages per `JIRA_LANG`.
- JSDoc on exported functions.
- No `console.log` in the MCP server on stdout (stdout = the protocol!). Debug only on stderr,
  behind the `JIRA_DEBUG=1` flag.
- `plugin.json`: name `jira-tools`, semver from `0.1.0`, description, author.

## 8. Tests

### 8.1 Unit (`npm test`)

Mock `globalThis.fetch`. Cover:

- key-range expansion (`PROJ-98..111`, `PROJ-98..PROJ-111`, singles, mixed),
- building JQL via helpers,
- error mapping (401/404/500/timeout),
- compact formatting (a snapshot on a sample ticket JSON),
- config: precedence env > file > none,
- the fact that all tools (read + write) are always registered, and without a config each returns the setup instruction,
- Zephyr (§4.6): both cycle-listing shapes, ZQL paging, HTTP-200 failures, date conversion, the budget and
  duplicate rails of the Zephyr write tools, the skip of tests already in a cycle, and the comment signature,
- shared project rules (§5.2): matching by person and type, add-only merge on create and on an assignee
  change, a failed read that does not block the write, and `set_project_rules` (dry run, all-or-nothing
  validation, ambiguous people, kept property keys, the 403 message, the budget),
- create rails (§4.2 safeguards 5 and 6): the refused create without a sprint choice (also for one item
  of a batch), the epic and sub-task exemption, the exact bug layout, the `[label]` title, a localised bug
  type, and `custom_template`.

### 8.2 Integration (opt-in, read-only)

Run only when `JIRA_TEST_SERVER` + `JIRA_TEST_TOKEN` are set
(`npm run test:integration`). Read-only: `myself`, `search` with a simple JQL,
`get_issue` on an existing key given in `JIRA_TEST_ISSUE`. Zero creation/modification.

Test environment (sandbox): project `DC` — board "DC board", sprint "DC Sprint 1",
sample keys `DC-1`, `DC-16`, `DC-18` (e.g. `JIRA_TEST_ISSUE=DC-16`). In the DC project
manual write tests are allowed (Phase 2); automated tests stay read-only.

### 8.3 Manual end-to-end test (checklist in README)

1. `claude` in any directory → `/plugin marketplace add /path/to/this/repo`
2. `/plugin install jira-tools@<marketplace-name>`
3. `/jira-tools:jira-setup` → go through configuration → see "Logged in as…"
4. `/mcp` → the `jira` server is visible and connected
5. `/get-tasks <PROJECT>` → returns my tasks
6. a natural-language question: "which of my tasks in `PROJECT` changed status yesterday?"
7. `/sprint-health` → a report with five sections
8. after code changes: `/reload-plugins` (SKILL.md is picked up live, .mcp.json requires a reload)

## 9. Phases

- **Phase 1 (MVP):** config + client + read tools + skills `/jira-setup`, `/get-tasks`,
  `/sprint-health`, `/check-stories`, `/find-bug` + unit tests + README.
- **Phase 2:** write tools behind a flag + `/create-task` with a dry-run.
- **Phase 3 (outside this repo, a separate decision):** Notion→Jira integration, use of the
  server by PMs in Claude Desktop/Cowork (the README should contain a configuration section
  for Claude Desktop with a sample `mcpServers` entry).
- **Sprint 3 (done):** a hook protecting the safeguards (§4.2 point 6), AI content
  marking (§4.2), templates per issue type (§5.1), the `/feedback` skill (§6), the compact mode
  of `get_issue` (§4.1).
- **Backlog — items from production use (via `/feedback`):**
  1. ✅ **`update_issue`** (done) — editing an existing issue on a whitelist of
     fields: `assignee`, `labels`/`add_labels`, `components`, `priority`, `description`.
  2. ✅ **Attachments** (done) — `add_attachment` (a file from a path on disk).
  3. ✅ **`link_issues`** (done) — "Relates"/other links between issues;
     `create-task` proposes linking the per-platform tickets of a single story.
  4. **`add_attachment_from_chat`** (to do) — uploading a screenshot **pasted into the
     conversation**, without saving it manually. Verified empirically 2026-07-16:
     Claude Code writes the session transcript to `~/.claude/projects/<project-directory>/<uuid>.jsonl`,
     and pasted images sit in it as blocks `{"type":"image","source":{"type":"base64",
     "media_type":"image/png","data":"…"}}` (in the working session: 16 images). The MCP server
     runs locally, so it can read the freshest transcript, take the Nth-from-last image
     block (`index`, default the last), decode base64 to a temporary file, and upload it via the
     existing `addAttachment` path. To check separately: the location of transcripts
     in Claude Desktop. Security: only image blocks, only the current project,
     information about what was found before uploading, the same safeguards as the rest of writing.
  5. ✅ **Zephyr Squad Server** (done) — test cases with steps, test cycles, executions and
     results (§4.6) + the `/test-cases` skill. Asked for by QA: keep all test cases in Zephyr,
     build a test plan and run it without the manual upkeep that made the team drop Zephyr.
  6. ✅ **Shared project rules** (done) — "assignee → component" per project, stored in Jira (§5.2), set in
     plain words by the tester or the PM through `/project-rules`, applied in code on create and on an
     assignee change.
  7. ✅ **Sprint question and standard bug template** (done) — every new ticket needs the user's choice
     "active sprint or backlog", and every bug follows the standard bug template (§4.2 safeguards 5 and 6).
     Asked for by the team on 2026-11-25.
- **Backlog:** research into AI-first team practices (deliverable: a report with recommendations, not
  code); Notion→Jira once access to the Notion MCP is obtained (configuration, not development).
- **Rejected/shelved without a deadline:** task-context memory (Jira is the source of truth, a
  local cache drifts; it comes back only with concrete usage scenarios).

## 10. Definition of Done

- `npm test` green; `claude plugin validate` with no errors.
- The full 8.3 checklist passes on a clean install.
- The README is enough for a new team member to install on their own in <10 minutes.
- **Anonymization:** grepping the repo finds no token, password, company production
  URL, or company data — company name, production project keys,
  product names, internal branch names. In examples we use neutral `PROJ-n`
  and `https://jira.example.pl`. The only permissible real identifiers are the test
  sandbox `DC` ("DC board", "DC Sprint 1") — used only until the first installations.
  Company data enters exclusively through the user's local config / args files (gitignored).
