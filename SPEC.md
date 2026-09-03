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
│       │   └── tools/            # one file = one MCP tool
│       ├── skills/               # one directory = one slash command
│       │   ├── jira-setup/  jira-config/  jira-update/  get-tasks/
│       │   ├── sprint-health/  check-stories/  find-bug/
│       │   └── create-task/  feedback/
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

### 4.2 Write (phase 2 — behind a flag)

| Tool               | Parameters                                                                                              | Description                                                                                                              |
| ------------------ | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `create_issue`     | `project`, `issue_type` (role `epic/story/task/subtask/bug` or exact name), `summary`, `description` (Markdown → wiki), `description_format?`, `components[]`, `labels[]`, `assignee?`, `epic_key?`, `epic_name?`, `parent?`, `story_points?`, `sprint_id?`, `allow_duplicate?` | Creates ONE ticket. Returns key + URL. A role resolves to the project's own type name via the profile's `issueTypeRoles`. `parent` is required for a sub-task type (validated: the type must be a sub-task type and the parent must not be one). `epic_name` defaults to the summary on an epic. Story Points resolve by field name only. `sprint_id` (from `get_active_sprint`) places the ticket in the sprint — without it, it lands in the backlog; custom fields come from the profile or auto-detection. |
| `create_issues`    | `project`, `items[]` (each: the `create_issue` fields minus `project`; max 50)                            | Creates up to 50 tickets in ONE request (`POST /rest/api/2/issue/bulk`) — the sanctioned path for a breakdown. Same per-item rules as `create_issue`. The whole batch must fit the session budget or nothing is created; every item passes the duplicate guard (against Jira and within the batch). Parents must exist before children: epic → stories → sub-tasks in a second call. Returns keys and per-item errors. |
| `add_comment`      | `key`, `body`                                                                                           | Adds a comment.                                                                                                         |
| `transition_issue` | `key`, `transition_name`                                                                                | Status change (first fetch the available transitions, match by name case-insensitively, and if none match — list the available ones). |
| `update_issue`     | `key`, `summary?`, `assignee?`, `labels?`, `add_labels?`, `components?`, `priority?`, `description?` (Markdown → wiki), `description_format?`, `story_points?`, `sprint_id?`, `epic_key?`, `epic_name?` | Edits an existing issue (whitelist of fields). `labels`/`components` replace the lists, `add_labels` appends (read-modify-write). Custom fields (Story Points, Sprint, Epic Link, Epic Name) resolve as in `create_issue`. Status → `transition_issue`; a sub-task's parent is fixed at creation. |
| `add_attachment`   | `key`, `path`, `filename?`                                                                              | Uploads ONE file from disk as an attachment (multipart + `X-Atlassian-Token: no-check`, 10 MB limit). The path must be explicitly provided by the user — no globs. **An image pasted into the conversation is not a file**: it only reaches the model's context, and the tools do not have access to its bytes (confirmed in the documentation), so it must first be saved to disk. |
| `link_issues`      | `from`, `to[]` (ranges, max 20), `type?` (default "Relates")                                            | Creates links between issues (POST `/rest/api/2/issueLink`). The type is matched case-insensitively to the instance's types; if none match — a list of available ones. `create-task` proposes linking the per-platform tickets of a single story. |
| `assign_to_epic`   | `epic_key`, `keys[]` (ranges `PROJ-98..111`, max 20)                                                    | Attaches existing tasks to an epic (Agile API). Analyst use case: "stories from a release without an epic → attach them under the epic". Each task counts against the session budget. |

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

**AI content marking (transparency, always on):** `create_issue` adds, in code, the
label `ai-generated` (filterable: `labels = ai-generated`), and `add_comment` appends
a fixed signature `_(ai-generated · jira-tools)_` — Jira comments are not labeled.

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
        "bug": "Steps to reproduce:\n1. …\n\nExpected:\n…\n\nActual:\n…",
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
**Golden rule of write skills** (`/create-task`, `/feedback`): the agent **structures what the
user provided and asks about gaps — it never invents content**. An empty template section is a
signal to ask a question (and to gently push), not to fill it with a guess;
a deliberately omitted section gets a literal `(to be filled in)`. The template exists so
as to force the user to think, not to give the agent room to hallucinate.

Description templates (`taskTemplate` per type) are configured by `/jira-config` in three ways:
**import from designated reference tickets** (recommended — e.g. `BUG - PROJ-99, TASK - PROJ-100`;
the skill reads them via `get_issue` and derives the section structure in the team's style), a custom
pasted template, or the skill's own proposal.

- **`/create-task <description>`** — (phase 2) creates tickets per platform. From the case description it generates:
  title, description, acceptance criteria (in the language from the config), a component per platform
  (iOS/Android/Web/Backend → separate tickets). **MANDATORY dry-run:** first list
  all tickets to be created as a preview, wait for the user's confirmation,
  and only then call `create_issue`.

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
- the fact that all tools (read + write) are always registered, and without a config each returns the setup instruction.

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
