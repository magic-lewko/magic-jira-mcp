# jira-tools cheat sheet

Use plain language to work with Jira. `PROJ` is your project key.
Commands that start with `/` work in Claude Code only. The plain-language prompts work in both apps.

## First steps

1. Install the plugin. See the main README.
2. Configure the connection. In Claude Code, run `/jira-tools:jira-setup`. In Claude Desktop, type the Jira URL and the token in the install window of the `.mcpb` bundle.
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

Before the plugin creates a ticket, it asks: active sprint or backlog?

| Goal | Prompt |
| --- | --- |
| tickets per platform | `/jira-tools:create-task user logout on iOS and Web` |
| one ticket | `create a task in PROJ "Fix email validation"` |
| a bug | `report a bug in PROJ on Web: the Save button does nothing` |
| assign a person | `assign PROJ-42 to jkowalski` |
| add a label | `add the label regression to PROJ-42` |
| add a comment | `comment on PROJ-42: deployed to UAT. Please retest.` |
| add an attachment | Save the file first. Then run `attach C:\shots\bug.png to PROJ-42`. |
| change status | `move PROJ-42 to In Progress` |
| link tickets | `link PROJ-42 to PROJ-43 and PROJ-44` |
| attach stories to an epic | `attach stories PROJ-101 and PROJ-105..110 to epic PROJ-200` |

Each bug uses the standard bug template. The title is `[label] title`, for example `[Web] Save button does nothing`. The description has three bold sections: **Steps to reproduce**, **Actual result** and **Expected result**. To use a different template, tell the plugin before you confirm.

The plugin adds the `ai-generated` label to each ticket it creates. The plugin adds a short signature to each comment it writes.

## Tests (Zephyr Squad)

Use this section when your project keeps test cases in Zephyr. Each write shows a preview first.

| Goal | Prompt |
| --- | --- |
| test cases from a story | `/jira-tools:test-cases PROJ-12` |
| one test case | `show test PROJ-450 with its steps` |
| test cycles | `show the test cycles in PROJ` |
| cycle progress | `how far is test cycle Release 12 in PROJ?` |
| failed tests | `show the failed tests in cycle Release 12` |
| new test cycle | `create test cycle "Release 12 regression" in PROJ for UAT` |
| add tests to a cycle | `add PROJ-30..35 to test cycle Release 12` |
| record results | `PROJ-30 passed. PROJ-31 failed at step 2: the button stays grey.` |

The plugin adds the `ai-generated` label to each test case it creates. The plugin adds a short signature to each result comment it writes.

## Project rules

A project rule adds a component from the assignee. Jira keeps the rule, so all members of the project get it. Save it once at the start of the project. Change it when a person joins or leaves the team.

| Goal | Prompt |
| --- | --- |
| save a rule | `in PROJ, if a bug is assigned to Nowak or Kowalski, add the Frontend component` |
| add a person | `Wisniewski joined the Backend team in PROJ` |
| show the rules | `show the project rules of PROJ` |

The plugin adds the component when it creates a ticket or changes the assignee. An assignment that you make in Jira by hand adds no component. To save a rule, you must have the Administer Projects permission.

## The plugin refuses some writes on purpose

- The title matches an open ticket. The plugin points you to that ticket.
- You did not select the active sprint or the backlog. The plugin asks you first.
- A bug does not use the standard bug template. The plugin asks you for the missing sections.
- The session reaches the limit of 100 new tickets or 300 writes. This stops a loop.
- A bulk call creates at most 50 tickets. The whole batch must fit the session limit, or the plugin creates nothing.
- A call creates at most 25 test cases. The tests and their steps must fit the session limit, or the plugin creates nothing.
- A test cycle with the same name exists in the version.
- A key is not a Zephyr test. The plugin adds no test to the cycle.
- A name in a project rule matches more than one person. The plugin asks you to select the person.

## Problems

| Problem | Fix |
| --- | --- |
| "Jira is not configured" | Claude Code: run `/jira-tools:jira-setup`. Desktop: type the URL and the token in the plugin settings. |
| the config is wrong after an update | Run `/jira-tools:jira-update`. It keeps the server and the token. |
| 401, or the token expired | Create a new token. Open the avatar menu, then Personal Access Tokens. Configure the plugin again. |
| a timeout | Turn on the VPN. |
| the write tools are missing | Update the plugin. Then run `/reload-plugins`. |
| a new version is out | Claude Desktop: say "update jira-tools". Then double-click the file in Downloads. Claude Code: run `/plugin marketplace update magic-jira-mcp`. |
| the report shows the wrong status order | Run `/jira-tools:jira-config PROJ`. Select the correct board. |

Do you have an idea for the plugin? Run `/jira-tools:feedback`. It asks a few questions. Then it writes a Slack message.
