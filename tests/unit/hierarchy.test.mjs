/**
 * Breakdown support: sub-tasks (parent), epics (epic_name), role-based issue
 * types, Story Points, Markdown → wiki descriptions, parent-scoped duplicate
 * guard, and the bulk create_issues tool.
 */
import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import { registerTools } from '../../plugins/jira-tools/src/server.mjs'
import { resetWriteBudget, writeBudgetStatus } from '../../plugins/jira-tools/src/write-guard.mjs'

const CONFIG = {
  server: 'https://jira.example.pl',
  token: 't',
  projects: { PROJ: { epicLinkField: 'customfield_10008' } },
  writeBudget: { creates: 10, total: 30 },
}

/** No duplicates anywhere, unless a test overrides searchIssues. */
const NO_DUPLICATES = { searchIssues: async () => ({ issues: [], total: 0, startAt: 0 }) }

const TYPES_WITH_SUBTASK = { issueTypes: [{ name: 'Story', subtask: false }, { name: 'Sub-task', subtask: true }] }

beforeEach(() => resetWriteBudget())

/** Register everything and return the tool map. */
function setup({ client = {}, config = CONFIG } = {}) {
  const tools = new Map()
  const server = { registerTool: (name, cfg, handler) => tools.set(name, { cfg, handler }) }
  registerTools(server, { getConfig: () => config, client: { ...NO_DUPLICATES, ...client } })
  return tools
}

// --- create_issue: parent / epic_name / roles (B1, B2, P4) -------------------

test('create_issue: subtask role + parent → resolves the sub-task type and sets fields.parent', async () => {
  let sent = null
  const tools = setup({
    client: {
      getProject: async () => TYPES_WITH_SUBTASK,
      getIssue: async () => ({ key: 'PROJ-10', fields: { issuetype: { subtask: false }, summary: 'Parent story' } }),
      createIssue: async (_config, fields) => { sent = fields; return { key: 'PROJ-11' } },
    },
  })
  const result = await tools.get('create_issue').handler({
    project: 'PROJ', issue_type: 'subtask', summary: 'Config for iOS', parent: 'proj-10',
  })
  assert.equal(result.isError, undefined)
  assert.equal(sent.issuetype.name, 'Sub-task')
  assert.deepEqual(sent.parent, { key: 'PROJ-10' })
})

test('create_issue: parent on a non-sub-task type is refused, listing the sub-task types', async () => {
  let posted = false
  const tools = setup({
    client: {
      getProject: async () => TYPES_WITH_SUBTASK,
      createIssue: async () => { posted = true; return { key: 'PROJ-1' } },
    },
  })
  const result = await tools.get('create_issue').handler({
    project: 'PROJ', issue_type: 'Story', summary: 'Story with a parent', parent: 'PROJ-10',
  })
  assert.equal(result.isError, true)
  assert.match(result.content[0].text, /not a sub-task type/)
  assert.match(result.content[0].text, /Sub-task/)
  assert.equal(posted, false)
})

test('create_issue: a sub-task type without a parent is refused', async () => {
  const tools = setup({
    client: { getProject: async () => TYPES_WITH_SUBTASK, createIssue: async () => ({ key: 'PROJ-1' }) },
  })
  const result = await tools.get('create_issue').handler({ project: 'PROJ', issue_type: 'Sub-task', summary: 'Orphan sub-task' })
  assert.equal(result.isError, true)
  assert.match(result.content[0].text, /requires a parent/)
})

test('create_issue: a parent that is itself a sub-task is refused', async () => {
  const tools = setup({
    client: {
      getProject: async () => TYPES_WITH_SUBTASK,
      getIssue: async () => ({ key: 'PROJ-10', fields: { issuetype: { subtask: true } } }),
      createIssue: async () => ({ key: 'PROJ-1' }),
    },
  })
  const result = await tools.get('create_issue').handler({
    project: 'PROJ', issue_type: 'subtask', summary: 'Nested sub-task', parent: 'PROJ-10',
  })
  assert.equal(result.isError, true)
  assert.match(result.content[0].text, /itself a sub-task/)
})

test('create_issue: epic role sets Epic Name (defaults to the summary) via the gh-epic-label field', async () => {
  let sent = null
  const tools = setup({
    config: { ...CONFIG, projects: {} },
    client: {
      getProject: async () => ({ issueTypes: [{ name: 'Epic', subtask: false }] }),
      listFields: async () => [
        { id: 'customfield_10004', name: 'Epic Name', schema: { custom: 'com.pyxis.greenhopper.jira:gh-epic-label' } },
      ],
      createIssue: async (_config, fields) => { sent = fields; return { key: 'PROJ-100' } },
    },
  })
  await tools.get('create_issue').handler({ project: 'PROJ', issue_type: 'epic', summary: 'Login overhaul' })
  assert.equal(sent.issuetype.name, 'Epic')
  assert.equal(sent.customfield_10004, 'Login overhaul')
})

test('create_issue: explicit epic_name wins over the summary', async () => {
  let sent = null
  const tools = setup({
    config: { ...CONFIG, projects: { PROJ: { epicNameField: 'customfield_10004' } } },
    client: {
      getProject: async () => ({ issueTypes: [{ name: 'Epic', subtask: false }] }),
      createIssue: async (_config, fields) => { sent = fields; return { key: 'PROJ-100' } },
    },
  })
  await tools.get('create_issue').handler({ project: 'PROJ', issue_type: 'Epic', summary: 'Login overhaul', epic_name: 'LOGIN' })
  assert.equal(sent.customfield_10004, 'LOGIN')
})

test('create_issue: a role maps through the profile issueTypeRoles to a localised type name', async () => {
  let sent = null
  const tools = setup({
    config: { ...CONFIG, projects: { PROJ: { issueTypeRoles: { story: 'StoryLocal' }, epicNameField: 'customfield_10004' } } },
    client: {
      getProject: async () => ({ issueTypes: [{ name: 'StoryLocal', subtask: false }, { name: 'EpicLocal', subtask: false }] }),
      createIssue: async (_config, fields) => { sent = fields; return { key: 'PROJ-5' } },
    },
  })
  await tools.get('create_issue').handler({ project: 'PROJ', issue_type: 'story', summary: 'Mapped story type' })
  assert.equal(sent.issuetype.name, 'StoryLocal')
  assert.equal(sent.customfield_10004, undefined, 'a story must not get an Epic Name')
})

test('create_issue: story_points resolves the field by NAME only, never by a generic float suffix', async () => {
  let sent = null
  const tools = setup({
    config: { ...CONFIG, projects: {} },
    client: {
      listFields: async () => [
        { id: 'customfield_777', name: 'Some Number', schema: { custom: 'com.atlassian.jira.plugin.system.customfieldtypes:float' } },
        { id: 'customfield_10006', name: 'Story Points', schema: { custom: 'com.atlassian.jira.plugin.system.customfieldtypes:float' } },
      ],
      createIssue: async (_config, fields) => { sent = fields; return { key: 'PROJ-1' } },
    },
  })
  await tools.get('create_issue').handler({ project: 'PROJ', issue_type: 'Story', summary: 'Pointed story', story_points: 5 })
  assert.equal(sent.customfield_10006, 5)
  assert.equal(sent.customfield_777, undefined)
})

test('create_issue: description is converted from Markdown to wiki markup unless description_format=wiki', async () => {
  const sent = []
  const tools = setup({ client: { createIssue: async (_config, fields) => { sent.push(fields); return { key: 'PROJ-1' } } } })
  await tools.get('create_issue').handler({
    project: 'PROJ', issue_type: 'Task', summary: 'Markdown body', description: '## Steps\n- **bold** item',
  })
  assert.equal(sent[0].description, 'h2. Steps\n* *bold* item')
  await tools.get('create_issue').handler({
    project: 'PROJ', issue_type: 'Task', summary: 'Wiki body kept', description: 'h2. Steps\n* *bold* item', description_format: 'wiki',
  })
  assert.equal(sent[1].description, 'h2. Steps\n* *bold* item')
})

test('create_issue: duplicate guard is scoped to the parent for sub-tasks (P3)', async () => {
  const jqls = []
  const tools = setup({
    client: {
      searchIssues: async (_config, { jql }) => { jqls.push(jql); return { issues: [], total: 0, startAt: 0 } },
      getProject: async () => TYPES_WITH_SUBTASK,
      getIssue: async () => ({ key: 'PROJ-10', fields: { issuetype: { subtask: false } } }),
      createIssue: async () => ({ key: 'PROJ-11' }),
    },
  })
  await tools.get('create_issue').handler({ project: 'PROJ', issue_type: 'subtask', summary: 'Config', parent: 'PROJ-10' })
  assert.match(jqls[0], /project = PROJ/)
  assert.match(jqls[0], /parent = PROJ-10/)
})

// --- create_issues (bulk, B3) ------------------------------------------------

test('create_issues: one bulk POST, keys mapped in order, per-item errors reported, budget charged per created', async () => {
  let payload = null
  const tools = setup({
    client: {
      createIssuesBulk: async (_config, list) => {
        payload = list
        return {
          issues: [{ key: 'PROJ-1' }, { key: 'PROJ-3' }],
          errors: [{ status: 400, failedElementNumber: 1, elementErrors: { errorMessages: [], errors: { summary: 'too short' } } }],
        }
      },
    },
  })
  const result = await tools.get('create_issues').handler({
    project: 'proj',
    items: [
      { issue_type: 'Story', summary: 'First story' },
      { issue_type: 'Story', summary: 'Second story' },
      { issue_type: 'Story', summary: 'Third story' },
    ],
  })
  assert.equal(result.isError, undefined)
  assert.equal(payload.length, 3)
  assert.equal(payload[0].project.key, 'PROJ')
  assert.deepEqual(payload[0].labels, ['ai-generated'])
  const text = result.content[0].text
  assert.match(text, /Created 2\/3/)
  assert.match(text, /PROJ-1 "First story"/)
  assert.match(text, /item 2 "Second story": FAILED — summary: too short/)
  assert.match(text, /PROJ-3 "Third story"/)
  assert.equal(writeBudgetStatus(CONFIG).creates.used, 2, 'only the created items count against the budget')
})

test('create_issues: refuses the whole batch up front when it does not fit the budget, nothing is sent', async () => {
  let called = false
  const tools = setup({
    config: { ...CONFIG, writeBudget: { creates: 2, total: 30 } },
    client: { createIssuesBulk: async () => { called = true; return { issues: [], errors: [] } } },
  })
  const result = await tools.get('create_issues').handler({
    project: 'PROJ',
    items: [
      { issue_type: 'Task', summary: 'Task number one' },
      { issue_type: 'Task', summary: 'Task number two' },
      { issue_type: 'Task', summary: 'Task number three' },
    ],
  })
  assert.equal(result.isError, true)
  assert.match(result.content[0].text, /Session write limit would be exceeded/)
  assert.match(result.content[0].text, /3 more requested/)
  assert.equal(called, false)
})

test('create_issues: repeating a title within the batch (same parent) is refused before any HTTP', async () => {
  let called = false
  const tools = setup({ client: { createIssuesBulk: async () => { called = true; return { issues: [], errors: [] } } } })
  const result = await tools.get('create_issues').handler({
    project: 'PROJ',
    items: [{ issue_type: 'Task', summary: 'Same title' }, { issue_type: 'Task', summary: 'same  title' }],
  })
  assert.equal(result.isError, true)
  assert.match(result.content[0].text, /repeats an earlier item/)
  assert.equal(called, false)
})

test('create_issues: the same sub-task title under two different parents is allowed', async () => {
  let payload = null
  const tools = setup({
    client: {
      getProject: async () => TYPES_WITH_SUBTASK,
      getIssue: async (_config, key) => ({ key, fields: { issuetype: { subtask: false } } }),
      createIssuesBulk: async (_config, list) => { payload = list; return { issues: [{ key: 'PROJ-21' }, { key: 'PROJ-22' }], errors: [] } },
    },
  })
  const result = await tools.get('create_issues').handler({
    project: 'PROJ',
    items: [
      { issue_type: 'subtask', summary: 'Config', parent: 'PROJ-1' },
      { issue_type: 'subtask', summary: 'Config', parent: 'PROJ-2' },
    ],
  })
  assert.equal(result.isError, undefined)
  assert.deepEqual(payload.map((fields) => fields.parent.key), ['PROJ-1', 'PROJ-2'])
})

// --- update_issue: new fields (P1 + nice-to-have) ----------------------------

test('update_issue: summary, story_points, sprint_id, epic_key and epic_name resolve their fields', async () => {
  let sent = null
  const tools = setup({
    config: {
      ...CONFIG,
      projects: {
        PROJ: {
          epicLinkField: 'customfield_10008',
          sprintField: 'customfield_10001',
          epicNameField: 'customfield_10004',
          storyPointsField: 'customfield_10006',
        },
      },
    },
    client: { updateIssue: async (_config, key, fields) => { sent = { key, fields }; return null } },
  })
  const result = await tools.get('update_issue').handler({
    key: 'proj-42', summary: 'Fixed title', story_points: 3, sprint_id: 77, epic_key: 'proj-9', epic_name: 'Big epic',
  })
  assert.equal(result.isError, undefined)
  assert.deepEqual(sent, {
    key: 'PROJ-42',
    fields: {
      summary: 'Fixed title',
      customfield_10006: 3,
      customfield_10001: 77,
      customfield_10008: 'PROJ-9',
      customfield_10004: 'Big epic',
    },
  })
})

test('update_issue: description is converted from Markdown to wiki markup', async () => {
  let sent = null
  const tools = setup({ client: { updateIssue: async (_config, _key, fields) => { sent = fields; return null } } })
  await tools.get('update_issue').handler({ key: 'PROJ-42', description: '# Title\n1. first' })
  assert.equal(sent.description, 'h1. Title\n# first')
})
