import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

import { registerTools } from '../../plugins/jira-tools/src/server.mjs'
import { JiraError, getProjectProperty } from '../../plugins/jira-tools/src/jira-client.mjs'
import { resetWriteBudget, consumeWriteBudget, writeBudgetStatus } from '../../plugins/jira-tools/src/write-guard.mjs'
import {
  componentsForAssignee, mergeComponents, loadProjectRules, RULES_PROPERTY,
} from '../../plugins/jira-tools/src/project-rules.mjs'

const CONFIG = { server: 'https://jira.example.pl', token: 't', projects: {}, writeBudget: { creates: 10, total: 30 } }

const PROJECT = {
  key: 'PROJ',
  components: [{ name: 'Frontend' }, { name: 'Backend' }, { name: 'Mobile' }],
  issueTypes: [
    { name: 'Bug', subtask: false }, { name: 'Task', subtask: false }, { name: 'Story', subtask: false },
    { name: 'Sub-task', subtask: true },
  ],
}

const RULES = {
  componentRules: [
    { component: 'Frontend', assignees: ['anowak', 'bkowal'], issueTypes: ['Bug'] },
    { component: 'Backend', assignees: ['cwisniewski'], issueTypes: ['Bug'] },
    { component: 'Mobile', assignees: ['dzielinski'] },
  ],
  updatedBy: 'pm.user',
  updatedAt: '2026-11-25T10:00:00.000Z',
}

const USERS = [
  { name: 'anowak', displayName: 'Anna Nowak' },
  { name: 'bkowal', displayName: 'Bartosz Kowal' },
  { name: 'cwisniewski', displayName: 'Cezary Wisniewski' },
  { name: 'ewisniewska', displayName: 'Ewa Wisniewska' },
]

/** Jira's user search: matches the username or any word of the display name. */
async function findUsers(_config, text) {
  const q = text.toLowerCase()
  return USERS.filter((u) => u.name.startsWith(q) || u.displayName.toLowerCase().split(' ').some((w) => w.startsWith(q)))
}

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })
beforeEach(() => resetWriteBudget())

/** Register everything against a fake client and return the tool map. */
function setup(client = {}) {
  const tools = new Map()
  const server = { registerTool: (name, cfg, handler) => tools.set(name, { cfg, handler }) }
  const base = {
    searchIssues: async () => ({ issues: [], total: 0, startAt: 0 }),
    getProject: async () => PROJECT,
    getProjectProperty: async () => RULES,
    findUsers,
    getMyself: async () => ({ name: 'pm.user' }),
  }
  registerTools(server, { getConfig: () => CONFIG, client: { ...base, ...client } })
  return tools
}

// --- matching ------------------------------------------------------------------

test('componentsForAssignee matches the person and the issue type, case-insensitively', () => {
  const rules = RULES.componentRules
  assert.deepEqual(componentsForAssignee(rules, { assignee: 'ANowak', issueType: 'bug' }), ['Frontend'])
  assert.deepEqual(componentsForAssignee(rules, { assignee: 'anowak', issueType: 'Task' }), [])
  assert.deepEqual(componentsForAssignee(rules, { assignee: 'dzielinski', issueType: 'Story' }), ['Mobile'])
  assert.deepEqual(componentsForAssignee(rules, { assignee: '', issueType: 'Bug' }), [])
  assert.deepEqual(componentsForAssignee(rules, { assignee: 'nobody', issueType: 'Bug' }), [])
})

test('mergeComponents only adds what is missing', () => {
  assert.deepEqual(mergeComponents(['frontend', 'Web'], ['Frontend', 'Backend']), { list: ['frontend', 'Web', 'Backend'], added: ['Backend'] })
  assert.deepEqual(mergeComponents([], []), { list: [], added: [] })
})

test('loadProjectRules: no property means no rules; a broken value is ignored with a warning', async () => {
  const none = await loadProjectRules(CONFIG, { getProjectProperty: async () => null }, 'PROJ')
  assert.deepEqual(none.componentRules, [])
  assert.equal(none.warning, undefined)
  const broken = await loadProjectRules(CONFIG, { getProjectProperty: async () => ({ componentRules: [{ component: 'X' }] }) }, 'PROJ')
  assert.deepEqual(broken.componentRules, [])
  assert.match(broken.warning, /not valid/)
})

test('getProjectProperty reads the value and maps 404 to null', async () => {
  const calls = []
  const answers = [
    { status: 200, body: { key: RULES_PROPERTY, value: { componentRules: [] } } },
    { status: 404, body: { errorMessages: ['not found'] } },
  ]
  globalThis.fetch = async (url) => {
    calls.push(String(url))
    const next = answers.shift()
    return { ok: next.status < 400, status: next.status, text: async () => JSON.stringify(next.body) }
  }
  assert.deepEqual(await getProjectProperty(CONFIG, 'PROJ', RULES_PROPERTY), { componentRules: [] })
  assert.equal(await getProjectProperty(CONFIG, 'PROJ', RULES_PROPERTY), null)
  assert.equal(calls[0], 'https://jira.example.pl/rest/api/2/project/PROJ/properties/jira-tools')
})

// --- applying the rules ----------------------------------------------------------

test('create_issue: a bug for a rule person gets the rule component next to the given ones', async () => {
  let sent = null
  const tools = setup({ createIssue: async (_c, fields) => { sent = fields; return { key: 'PROJ-7' } } })
  const result = await tools.get('create_issue').handler({
    backlog: true,
    project: 'PROJ', issue_type: 'bug', summary: '[Web] Button stays grey', actual_result: 'The button stays grey', components: ['Mobile'], assignee: 'anowak',
  })
  assert.equal(result.isError, undefined)
  assert.deepEqual(sent.components, [{ name: 'Mobile' }, { name: 'Frontend' }])
  assert.match(result.content[0].text, /component Frontend added by the project rule/)
})

test('create_issue: no assignee means no rule lookup; another type means no rule component', async () => {
  let reads = 0
  let sent = null
  const tools = setup({
    getProjectProperty: async () => { reads += 1; return RULES },
    createIssue: async (_c, fields) => { sent = fields; return { key: 'PROJ-8' } },
  })
  await tools.get('create_issue').handler({ backlog: true, project: 'PROJ', issue_type: 'Task', summary: 'Plain task' })
  assert.equal(reads, 0)
  assert.equal(sent.components, undefined)
  await tools.get('create_issue').handler({ backlog: true, project: 'PROJ', issue_type: 'Task', summary: 'Task for a rule person', assignee: 'anowak' })
  assert.equal(reads, 1)
  assert.equal(sent.components, undefined)
})

test('create_issue: a failed rule read does not block the create and is reported', async () => {
  const tools = setup({
    getProjectProperty: async () => { throw new JiraError('Jira returned error 500') },
    createIssue: async () => ({ key: 'PROJ-9' }),
  })
  const result = await tools.get('create_issue').handler({ backlog: true, project: 'PROJ', issue_type: 'Bug', summary: '[iOS] Crash on start', actual_result: 'The app closes', assignee: 'anowak' })
  assert.equal(result.isError, undefined)
  assert.match(result.content[0].text, /Created PROJ-9/)
  assert.match(result.content[0].text, /could not be read/)
})

test('create_issues: one rule read for the batch, a note per matching item', async () => {
  let reads = 0
  let payload = null
  const tools = setup({
    getProjectProperty: async () => { reads += 1; return RULES },
    createIssuesBulk: async (_c, list) => { payload = list; return { issues: [{ key: 'PROJ-1' }, { key: 'PROJ-2' }], errors: [] } },
  })
  const result = await tools.get('create_issues').handler({
    project: 'PROJ',
    items: [
      { backlog: true, issue_type: 'Bug', summary: '[Web] Login fails', actual_result: 'Error 500', assignee: 'cwisniewski' },
      { backlog: true, issue_type: 'Bug', summary: '[Web] Logout fails', actual_result: 'Error 500' },
    ],
  })
  assert.equal(reads, 1)
  assert.deepEqual(payload[0].components, [{ name: 'Backend' }])
  assert.equal(payload[1].components, undefined)
  assert.match(result.content[0].text, /PROJ-1 "\[Web\] Login fails" · \+Backend \(project rule\)/)
  assert.doesNotMatch(result.content[0].text, /PROJ-2 "\[Web\] Logout fails" · \+/)
})

test('update_issue: a new assignee adds the rule component and keeps the current ones', async () => {
  let sent = null
  const tools = setup({
    getIssue: async () => ({ fields: { components: [{ name: 'Mobile' }], issuetype: { name: 'Bug' } } }),
    updateIssue: async (_c, _k, fields) => { sent = fields },
  })
  const result = await tools.get('update_issue').handler({ key: 'PROJ-42', assignee: 'bkowal' })
  assert.deepEqual(sent, { assignee: { name: 'bkowal' }, components: [{ name: 'Mobile' }, { name: 'Frontend' }] })
  assert.match(result.content[0].text, /components \+= Frontend \(project rule\)/)
})

test('update_issue: nothing extra when the issue already has the component', async () => {
  let sent = null
  const tools = setup({
    getIssue: async () => ({ fields: { components: [{ name: 'Frontend' }], issuetype: { name: 'Bug' } } }),
    updateIssue: async (_c, _k, fields) => { sent = fields },
  })
  await tools.get('update_issue').handler({ key: 'PROJ-42', assignee: 'anowak' })
  assert.deepEqual(sent, { assignee: { name: 'anowak' } })
})

// --- get_project_rules -------------------------------------------------------------

test('get_project_rules lists the rules with the last change', async () => {
  const text = (await setup().get('get_project_rules').handler({ project: 'proj' })).content[0].text
  assert.match(text, /Shared rules of PROJ/)
  assert.match(text, /- Bug → Frontend: anowak, bkowal/)
  assert.match(text, /- Any type → Mobile: dzielinski/)
  assert.match(text, /Last change: pm\.user, 2026-11-25/)
})

test('get_project_rules without rules says how to set them', async () => {
  const text = (await setup({ getProjectProperty: async () => null }).get('get_project_rules').handler({ project: 'PROJ' })).content[0].text
  assert.match(text, /No shared rules in PROJ/)
})

// --- set_project_rules -------------------------------------------------------------

const INPUT = {
  project: 'proj',
  component_rules: [
    { component: 'frontend', assignees: ['Nowak', 'bkowal'], issue_types: ['bug'] },
    { component: 'Backend', assignees: ['cwisniewski'], issue_types: ['Bug'] },
  ],
}

test('set_project_rules dry_run resolves people, types and components and saves nothing', async () => {
  let saved = false
  const tools = setup({ setProjectProperty: async () => { saved = true } })
  const result = await tools.get('set_project_rules').handler({ ...INPUT, dry_run: true })
  const text = result.content[0].text
  assert.equal(result.isError, undefined)
  assert.equal(saved, false)
  assert.match(text, /Preview, nothing saved/)
  assert.match(text, /- Bug → Frontend: anowak \(Anna Nowak\), bkowal \(Bartosz Kowal\)/)
  assert.equal(writeBudgetStatus(CONFIG).total.used, 0)
})

test('set_project_rules saves the full list, keeps other keys and records who changed it', async () => {
  let saved = null
  const tools = setup({
    getProjectProperty: async () => ({ ...RULES, otherRule: 1 }),
    setProjectProperty: async (_c, project, key, value) => { saved = { project, key, value } },
  })
  const result = await tools.get('set_project_rules').handler(INPUT)
  assert.equal(result.isError, undefined)
  assert.equal(saved.project, 'PROJ')
  assert.equal(saved.key, 'jira-tools')
  assert.deepEqual(saved.value.componentRules, [
    { component: 'Frontend', assignees: ['anowak', 'bkowal'], issueTypes: ['Bug'] },
    { component: 'Backend', assignees: ['cwisniewski'], issueTypes: ['Bug'] },
  ])
  assert.equal(saved.value.otherRule, 1)
  assert.equal(saved.value.updatedBy, 'pm.user')
  assert.match(result.content[0].text, /Saved 2 component rule\(s\) for PROJ/)
  assert.equal(writeBudgetStatus(CONFIG).total.used, 1)
})

test('set_project_rules saves nothing when one component, type or person is wrong', async () => {
  let saved = false
  const tools = setup({ setProjectProperty: async () => { saved = true } })
  const result = await tools.get('set_project_rules').handler({
    project: 'PROJ',
    component_rules: [
      { component: 'Flutter', assignees: ['anowak'] },
      { component: 'Backend', assignees: ['Wisniewsk', 'ghost'], issue_types: ['incident'] },
    ],
  })
  const text = result.content[0].text
  assert.equal(result.isError, true)
  assert.equal(saved, false)
  assert.match(text, /Nothing saved/)
  assert.match(text, /rule 1: PROJ has no component "Flutter"/)
  assert.match(text, /rule 2: PROJ has no issue type "incident"/)
  assert.match(text, /"Wisniewsk" matches 2 users: cwisniewski \(Cezary Wisniewski\), ewisniewska \(Ewa Wisniewska\)/)
  assert.match(text, /no active Jira user matches "ghost"/)
})

test('set_project_rules: no permission gives a clear message; the budget stops it before any HTTP', async () => {
  const denied = setup({ setProjectProperty: async () => { throw new JiraError('Jira returned error 403', { status: 403 }) } })
  const result = await denied.get('set_project_rules').handler(INPUT)
  assert.equal(result.isError, true)
  assert.match(result.content[0].text, /needs the Administer Projects permission/)

  resetWriteBudget()
  let calls = 0
  const tools = setup({ getProject: async () => { calls += 1; return PROJECT } })
  for (let i = 0; i < CONFIG.writeBudget.total; i++) consumeWriteBudget(CONFIG, 'write')
  const refused = await tools.get('set_project_rules').handler(INPUT)
  assert.equal(refused.isError, true)
  assert.equal(calls, 0)
})

test('set_project_rules with an empty list clears the rules', async () => {
  let saved = null
  const tools = setup({ setProjectProperty: async (_c, _p, _k, value) => { saved = value } })
  const result = await tools.get('set_project_rules').handler({ project: 'PROJ', component_rules: [] })
  assert.deepEqual(saved.componentRules, [])
  assert.match(result.content[0].text, /no rules — this clears them/)
})
