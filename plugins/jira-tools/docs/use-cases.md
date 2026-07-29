# jira-tools cheat sheet

Use plain language to work with Jira. `PROJ` is your project key.
Commands that start with `/` work in Claude Code only. The plain-language prompts work in both apps.

## First steps

1. Install the plugin. See the main README.
2. Configure the connection. In Claude Code, run `/jira-tools:jira-setup`. In Claude Desktop, type the Jira URL and the token in the plugin settings.
3. Save a project profile. In Claude Code, run `/jira-tools:jira-config PROJ`.
4. Ask `show my tasks in PROJ`.

## Read

| Goal | Prompt |
| --- | --- |
| your tasks | `show my tasks in PROJ in the current sprint` |
| one ticket | `show PROJ-42` |
| many tickets | `show PROJ-98..111` |
| status history | `show the status history of PROJ-42` |
| active sprint | `show the active sprint in PROJ` |
| sprint tickets | `list the tickets in the current sprint of PROJ` |
| sprint health report | `/jira-tools:sprint-health` |
| epic status | `show the status of epic PROJ-40` |
| story audit | `/jira-tools:check-stories PROJ` |
| bug status and environment | `is the notification counter bug on UAT?` |
| duplicate check | `show open bugs about sharing` |
| free question | `show what moved to Done yesterday` |

## Write

Each write shows a preview first. The plugin creates the ticket after you confirm.

| Goal | Prompt |
| --- | --- |
| tickets per platform | `/jira-tools:create-task user logout on iOS and Web` |
| one ticket | `create a task in PROJ "Fix email validation"` |
| assign a person | `assign PROJ-42 to jkowalski` |
| add a label | `add the label regression to PROJ-42` |
| add a comment | `comment on PROJ-42: deployed to UAT. Please retest.` |
| add an attachment | Save the file first. Then run `attach C:\shots\bug.png to PROJ-42`. |
| change status | `move PROJ-42 to In Progress` |
| link tickets | `link PROJ-42 to PROJ-43 and PROJ-44` |
| attach stories to an epic | `attach stories PROJ-101 and PROJ-105..110 to epic PROJ-200` |

The plugin adds the `ai-generated` label to each ticket it creates. The plugin adds a short signature to each comment it writes.

## The plugin refuses some writes on purpose

- The title matches an open ticket. The plugin points you to that ticket.
- The session reaches the limit of 10 new tickets or 30 writes. This stops a loop.
- The plugin creates one ticket per call. It has no bulk mode.

## Problems

| Problem | Fix |
| --- | --- |
| "Jira is not configured" | Claude Code: run `/jira-tools:jira-setup`. Desktop: type the URL and the token in the plugin settings. |
| the config is wrong after an update | Run `/jira-tools:jira-update`. It keeps the server and the token. |
| 401, or the token expired | Create a new token. Open the avatar menu, then Personal Access Tokens. Configure the plugin again. |
| a timeout | Turn on the VPN. |
| the write tools are missing | Update the plugin. Then run `/reload-plugins`. |
| the report shows the wrong status order | Run `/jira-tools:jira-config PROJ`. Select the correct board. |

Do you have an idea for the plugin? Run `/jira-tools:feedback`. It asks a few questions. Then it writes a Slack message.
