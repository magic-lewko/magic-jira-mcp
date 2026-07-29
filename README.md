# jira-claude-plugin

Talk to Jira in plain language through Claude — sprint reports, finding bugs by
description, creating and editing tickets. One MCP server works in both Claude
Desktop and Claude Code.

16 tools · 8 skills. Full examples: [docs/use-cases.md](plugins/jira-tools/docs/use-cases.md) · spec: [SPEC.md](SPEC.md).

## Requirements

- Node.js ≥ 20 (`node -v`)
- Jira access (VPN if needed) + your own Personal Access Token: Jira → avatar → **Personal Access Tokens** → **Create token**

## Claude Desktop

1. Clone the repo somewhere permanent: `git clone https://github.com/magic-lewko/magic-jira-mcp.git`
2. Claude Desktop → **Settings → Developer → Edit Config** → add (fix the path to use `/`, plus your URL and token):

   ```json
   {
     "mcpServers": {
       "jira": {
         "command": "node",
         "args": ["C:/path/to/repo/plugins/jira-tools/servers/jira-mcp.mjs"],
         "env": { "JIRA_SERVER": "https://jira.example.pl", "JIRA_TOKEN": "<PAT>" }
       }
     }
   }
   ```

3. Restart Claude Desktop → ask "who am I in Jira?".

You talk in plain language — the `/…` commands exist only in Claude Code.

## Claude Code

Add the marketplace and install the plugin:

```text
/plugin marketplace add https://github.com/magic-lewko/magic-jira-mcp
/plugin install jira-tools@magic-jira-mcp
/jira-tools:jira-setup          # URL, token, language, project
/jira-tools:jira-config PROJ    # project profile
```

Done when you see "Logged in as …". Then try `show my tasks in PROJ`.

## What it does

Read: my tasks, ticket details/ranges, status history, boards/sprints, epic
status, **sprint health report**, **find a bug by description + environment**, story audit.

Write: create tickets per platform, edit fields, comment, attach files, change
status, link issues, assign to epic. Creation always shows a preview and waits
for your confirmation.

Skills: `jira-setup`, `jira-config`, `get-tasks`, `sprint-health`, `check-stories`,
`find-bug`, `create-task`, `feedback`.

## Safety

Session budget (hard stop against creation loops) · duplicate guard · one ticket
per call · `/create-task` always previews first · AI-created tickets get an
`ai-generated` label.

## For developers

```text
npm install
npm test            # unit tests
npm run build       # server bundle (after every change in src/)
npm run selftest    # self-test on a live board (-- --write)
```

Branches: `develop` → `uat` → `main`.
