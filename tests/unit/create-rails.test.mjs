/**
 * Rails for new issues: the user's sprint choice (sprint_id or backlog=true,
 * epics and sub-tasks exempt) and the standard bug template ("[label] title"
 * plus Steps to reproduce / Actual result / Expected result).
 */
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import { registerTools } from '../../plugins/jira-tools/src/server.mjs'
import { resetWriteBudget } from '../../plugins/jira-tools/src/write-guard.mjs'
import { bugDescription } from '../../plugins/jira-tools/src/issue-fields.mjs'

const CONFIG = {
  server: 'https://jira.example.pl',
  token: 't',
  projects: { PROJ: { epicLinkField: 'customfield_10008', epicNameField: 'customfield_10009' } },
  writeBudget: { creates: 10, total: 30 },
}

beforeEach(() => resetWriteBudget())

/** Register everything over a fake client; counts duplicate searches. */
function setup({ client = {}, config = CONFIG } = {}) {
  const calls = { searches: 0, posts: [] }
  const tools = new Map()
  const server = { registerTool: (name, cfg, handler) => tools.set(name, { cfg, handler }) }
  registerTools(server, {
    getConfig: () => config,
    client: {
      searchIssues: async () => { calls.searches += 1; return { issues: [], total: 0, startAt: 0 } },
      createIssue: async (_c, fields) => { calls.posts.push(fields); return { key: 'PROJ-5' } },
      createIssuesBulk: async (_c, list) => { calls.posts.push(...list); return { issues: list.map((_, n) => ({ key: `PROJ-${n + 1}` })), errors: [] } },
      ...client,
    },
  })
  return { tools, calls }
}

const BUG = {
  project: 'PROJ',
  issue_type: 'bug',
  summary: '[Web] Save button does nothing',
  steps_to_reproduce: ['1. Open the profile page', 'Change the name', 'Click **Save**'],
  actual_result: 'Nothing happens',
  expected_result: 'The new name is saved',
  backlog: true,
}

// --- standard bug template ----------------------------------------------------

test('bugDescription: bold headers, a blank line before each section, numbered steps', () => {
  assert.equal(bugDescription(BUG), [
    '*Steps to reproduce:*',
    '# Open the profile page',
    '# Change the name',
    '# Click *Save*',
    '',
    '*Actual result:*',
    'Nothing happens',
    '',
    '*Expected result:*',
    'The new name is saved',
  ].join('\n'))
})

test('bugDescription: a skipped section gets "(to be filled in)"', () => {
  const text = bugDescription({ actual_result: 'Error 500' })
  assert.match(text, /^\*Steps to reproduce:\*\n\(to be filled in\)\n\n\*Actual result:\*\nError 500\n\n\*Expected result:\*\n\(to be filled in\)$/)
})

test('create_issue: a bug gets the template description, extra notes go below it', async () => {
  const { tools, calls } = setup()
  const result = await tools.get('create_issue').handler({ ...BUG, description: '**Environment:** UAT' })
  assert.equal(result.isError, undefined)
  assert.equal(calls.posts[0].summary, '[Web] Save button does nothing')
  assert.equal(calls.posts[0].description, `${bugDescription(BUG)}\n\n*Environment:* UAT`)
})

test('create_issue: a bug without the template fields is refused before any request', async () => {
  const { tools, calls } = setup()
  const result = await tools.get('create_issue').handler({
    project: 'PROJ', issue_type: 'Bug', summary: '[Web] Save button does nothing', description: 'It is broken', backlog: true,
  })
  assert.equal(result.isError, true)
  assert.match(result.content[0].text, /^Not created — a bug uses the standard bug template/)
  assert.match(result.content[0].text, /custom_template=true/)
  assert.equal(calls.searches, 0)
  assert.equal(calls.posts.length, 0)
})

test('create_issue: a bug title without a [label] is refused', async () => {
  const { tools, calls } = setup()
  const result = await tools.get('create_issue').handler({ ...BUG, summary: 'Save button does nothing' })
  assert.equal(result.isError, true)
  assert.match(result.content[0].text, /"\[label\] title"/)
  assert.equal(calls.posts.length, 0)
})

test('create_issue: custom_template=true keeps the description as written', async () => {
  const { tools, calls } = setup()
  const result = await tools.get('create_issue').handler({
    project: 'PROJ', issue_type: 'Bug', summary: 'Crash report', description: 'h3. Log\nline', description_format: 'wiki',
    custom_template: true, backlog: true,
  })
  assert.equal(result.isError, undefined)
  assert.equal(calls.posts[0].description, 'h3. Log\nline')
})

test('create_issue: a localised bug type from the profile map also needs the template', async () => {
  const { tools } = setup({
    config: { ...CONFIG, projects: { PROJ: { issueTypeRoles: { bug: 'Defect' } } } },
    client: { getProject: async () => ({ issueTypes: [{ name: 'Defect', subtask: false }, { name: 'Task', subtask: false }] }) },
  })
  const result = await tools.get('create_issue').handler({
    project: 'PROJ', issue_type: 'Defect', summary: '[iOS] App closes on start', backlog: true,
  })
  assert.equal(result.isError, true)
  assert.match(result.content[0].text, /standard bug template/)
})

// --- sprint choice --------------------------------------------------------------

test('create_issue: no sprint_id and no backlog=true is refused, the user must choose', async () => {
  const { tools, calls } = setup()
  const result = await tools.get('create_issue').handler({ project: 'PROJ', issue_type: 'Task', summary: 'Plain task' })
  assert.equal(result.isError, true)
  assert.match(result.content[0].text, /^Not created — ask the user first: the active sprint or the backlog\?/)
  assert.equal(calls.searches, 0)
  assert.equal(calls.posts.length, 0)
})

test('create_issue: sprint_id together with backlog=true is refused', async () => {
  const { tools } = setup({ config: { ...CONFIG, projects: { PROJ: { sprintField: 'customfield_10020' } } } })
  const result = await tools.get('create_issue').handler({
    project: 'PROJ', issue_type: 'Task', summary: 'Plain task', sprint_id: 9, backlog: true,
  })
  assert.equal(result.isError, true)
  assert.match(result.content[0].text, /contradict each other/)
})

test('create_issue: backlog=true sends no Sprint field', async () => {
  const { tools, calls } = setup()
  const result = await tools.get('create_issue').handler({ project: 'PROJ', issue_type: 'Task', summary: 'Plain task', backlog: true })
  assert.equal(result.isError, undefined)
  assert.equal(Object.keys(calls.posts[0]).some((field) => field.startsWith('customfield_')), false)
})

test('create_issue: epics and sub-tasks need no sprint choice', async () => {
  const { tools, calls } = setup({
    client: {
      getProject: async () => ({ issueTypes: [{ name: 'Epic', subtask: false }, { name: 'Sub-task', subtask: true }] }),
      getIssue: async () => ({ fields: { issuetype: { subtask: false } } }),
    },
  })
  assert.equal((await tools.get('create_issue').handler({ project: 'PROJ', issue_type: 'epic', summary: 'Login overhaul' })).isError, undefined)
  assert.equal((await tools.get('create_issue').handler({
    project: 'PROJ', issue_type: 'subtask', summary: 'Config screen', parent: 'PROJ-10',
  })).isError, undefined)
  assert.equal(calls.posts.length, 2)
})

test('create_issues: one item without a sprint choice stops the whole batch before any request', async () => {
  const { tools, calls } = setup()
  const result = await tools.get('create_issues').handler({
    project: 'PROJ',
    items: [
      { issue_type: 'Task', summary: 'First task', sprint_id: 9 },
      { issue_type: 'Task', summary: 'Second task' },
    ],
  })
  assert.equal(result.isError, true)
  assert.match(result.content[0].text, /^Nothing created — item 2 \("Second task"\): ask the user first/)
  assert.equal(calls.searches, 0)
  assert.equal(calls.posts.length, 0)
})

test('create_issues: bug items get the template description', async () => {
  const { project, ...item } = BUG
  const { tools, calls } = setup()
  const result = await tools.get('create_issues').handler({ project, items: [item] })
  assert.equal(result.isError, undefined)
  assert.equal(calls.posts[0].description, bugDescription(BUG))
})
