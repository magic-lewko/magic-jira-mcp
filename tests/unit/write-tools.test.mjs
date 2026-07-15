import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import { registerTools } from '../../plugins/jira-tools/src/server.mjs'
import { JiraError } from '../../plugins/jira-tools/src/jira-client.mjs'
import { resetWriteBudget, consumeWriteBudget, DEFAULT_WRITE_BUDGET } from '../../plugins/jira-tools/src/write-guard.mjs'

const CONFIG = {
  server: 'https://jira.example.pl',
  token: 't',
  allowWrite: true,
  projects: { PROJ: { epicLinkField: 'customfield_10008' } },
  writeBudget: { creates: 10, total: 30 },
}

/** No duplicates anywhere, unless a test overrides searchIssues. */
const NO_DUPLICATES = { searchIssues: async () => ({ issues: [], total: 0, startAt: 0 }) }

beforeEach(() => resetWriteBudget())

/** Register everything with allowWrite and return the tool map. */
function setup({ client = {}, config = CONFIG } = {}) {
  const tools = new Map()
  const server = { registerTool: (name, cfg, handler) => tools.set(name, { cfg, handler }) }
  registerTools(server, { getConfig: () => config, client: { ...NO_DUPLICATES, ...client } })
  return tools
}

// --- registration gate --------------------------------------------------------

test('real write tools registered only with allowWrite=true', () => {
  const withWrite = setup()
  for (const name of ['create_issue', 'add_comment', 'transition_issue']) {
    assert.ok(withWrite.has(name), `${name} should be registered`)
  }
  const readOnly = setup({ config: { ...CONFIG, allowWrite: false } })
  for (const name of ['create_issue', 'add_comment', 'transition_issue']) {
    assert.equal(readOnly.has(name), false, `${name} must be absent in read-only mode`)
  }
})

// --- create_issue --------------------------------------------------------------

test('create_issue: builds correct POST fields and returns key + URL', async () => {
  let sent = null
  const tools = setup({
    client: {
      createIssue: async (_config, fields) => { sent = fields; return { key: 'PROJ-100' } },
    },
  })
  const result = await tools.get('create_issue').handler({
    project: 'proj',
    issue_type: 'Task',
    summary: 'Logout flow on iOS',
    description: 'desc',
    components: ['iOS'],
    labels: ['mobile'],
    assignee: 'jkowalski',
    epic_key: 'proj-40',
  })
  assert.equal(result.isError, undefined)
  assert.match(result.content[0].text, /Utworzono PROJ-100 — https:\/\/jira\.example\.pl\/browse\/PROJ-100/)
  assert.deepEqual(sent, {
    project: { key: 'PROJ' },
    issuetype: { name: 'Task' },
    summary: 'Logout flow on iOS',
    description: 'desc',
    components: [{ name: 'iOS' }],
    labels: ['mobile'],
    assignee: { name: 'jkowalski' },
    customfield_10008: 'PROJ-40',
  })
})

test('create_issue: epic link field discovered via listFields when no profile', async () => {
  let sent = null
  const tools = setup({
    config: { ...CONFIG, projects: {} },
    client: {
      listFields: async () => [{ id: 'customfield_777', name: 'Epic Link' }],
      createIssue: async (_config, fields) => { sent = fields; return { key: 'PROJ-101' } },
    },
  })
  await tools.get('create_issue').handler({
    project: 'PROJ', issue_type: 'Task', summary: 'Some new work', epic_key: 'PROJ-1',
  })
  assert.equal(sent.customfield_777, 'PROJ-1')
})

test('create_issue: refuses an open duplicate and returns the existing key', async () => {
  let posted = false
  const tools = setup({
    client: {
      searchIssues: async () => ({
        issues: [{ key: 'PROJ-7', fields: { summary: '  logout   flow on iOS ', status: { name: 'To Do' } } }],
        total: 1,
        startAt: 0,
      }),
      createIssue: async () => { posted = true; return { key: 'PROJ-999' } },
    },
  })
  const result = await tools.get('create_issue').handler({
    project: 'PROJ', issue_type: 'Task', summary: 'Logout flow on iOS',
  })
  assert.equal(result.isError, true)
  assert.match(result.content[0].text, /PROJ-7/)
  assert.match(result.content[0].text, /allow_duplicate/)
  assert.equal(posted, false, 'must not POST when a duplicate exists')
})

test('create_issue: allow_duplicate=true bypasses the duplicate guard', async () => {
  const tools = setup({
    client: {
      searchIssues: async () => ({ issues: [{ key: 'PROJ-7', fields: { summary: 'Logout flow on iOS' } }], total: 1, startAt: 0 }),
      createIssue: async () => ({ key: 'PROJ-999' }),
    },
  })
  const result = await tools.get('create_issue').handler({
    project: 'PROJ', issue_type: 'Task', summary: 'Logout flow on iOS', allow_duplicate: true,
  })
  assert.equal(result.isError, undefined)
  assert.match(result.content[0].text, /PROJ-999/)
})

// --- session write budget -------------------------------------------------------

test('budget: creates limit stops further create_issue calls with a clear message', async () => {
  const config = { ...CONFIG, writeBudget: { creates: 2, total: 30 } }
  const tools = setup({
    config,
    client: { createIssue: async () => ({ key: 'PROJ-1' }) },
  })
  const create = (n) => tools.get('create_issue').handler({
    project: 'PROJ', issue_type: 'Task', summary: `Unique ticket number ${n}`,
  })
  assert.equal((await create(1)).isError, undefined)
  assert.equal((await create(2)).isError, undefined)
  const third = await create(3)
  assert.equal(third.isError, true)
  assert.match(third.content[0].text, /Limit zapisów w tej sesji osiągnięty \(2\/2/)
  assert.match(third.content[0].text, /reload-plugins/)
})

test('budget: total limit covers comments and transitions too', () => {
  const config = { writeBudget: { creates: 10, total: 2 } }
  consumeWriteBudget(config, 'write')
  consumeWriteBudget(config, 'write')
  assert.throws(() => consumeWriteBudget(config, 'write'), JiraError)
  assert.throws(() => consumeWriteBudget(config, 'create'), /Limit zapisów/)
})

test('budget: defaults applied when config has none', () => {
  for (let i = 0; i < DEFAULT_WRITE_BUDGET.creates; i++) consumeWriteBudget({}, 'create')
  assert.throws(() => consumeWriteBudget({}, 'create'), /10\/10/)
})

// --- add_comment ---------------------------------------------------------------

test('add_comment: posts and returns the browse URL', async () => {
  let posted = null
  const tools = setup({
    client: { addComment: async (_config, key, body) => { posted = { key, body }; return {} } },
  })
  const result = await tools.get('add_comment').handler({ key: 'proj-42', body: 'Deployed to UAT' })
  assert.deepEqual(posted, { key: 'PROJ-42', body: 'Deployed to UAT' })
  assert.match(result.content[0].text, /Dodano komentarz do PROJ-42/)
})

// --- transition_issue -----------------------------------------------------------

test('transition_issue: matches case-insensitively and reports the target status', async () => {
  let transitioned = null
  const tools = setup({
    client: {
      listTransitions: async () => ({
        transitions: [
          { id: '11', name: 'In Progress', to: { name: 'In Progress' } },
          { id: '21', name: 'Done', to: { name: 'Done' } },
        ],
      }),
      doTransition: async (_config, key, id) => { transitioned = { key, id }; return null },
    },
  })
  const result = await tools.get('transition_issue').handler({ key: 'PROJ-42', transition_name: 'in progress' })
  assert.deepEqual(transitioned, { key: 'PROJ-42', id: '11' })
  assert.match(result.content[0].text, /wykonano przejście "In Progress" → status: In Progress/)
})

test('transition_issue: unknown name lists the available transitions and does not POST', async () => {
  let posted = false
  const tools = setup({
    client: {
      listTransitions: async () => ({ transitions: [{ id: '11', name: 'In Progress' }, { id: '21', name: 'Done' }] }),
      doTransition: async () => { posted = true; return null },
    },
  })
  const result = await tools.get('transition_issue').handler({ key: 'PROJ-42', transition_name: 'Zrobione' })
  assert.equal(result.isError, true)
  assert.match(result.content[0].text, /Dostępne przejścia: "In Progress", "Done"/)
  assert.equal(posted, false)
})
