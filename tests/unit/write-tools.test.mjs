import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'

import { registerTools } from '../../plugins/jira-tools/src/server.mjs'
import { JiraError } from '../../plugins/jira-tools/src/jira-client.mjs'
import { resetWriteBudget, consumeWriteBudget, DEFAULT_WRITE_BUDGET } from '../../plugins/jira-tools/src/write-guard.mjs'

const CONFIG = {
  server: 'https://jira.example.pl',
  token: 't',
  allowWrite: true,
  aiLabel: false, // AI-marking tested separately — keep base assertions exact
  projects: { PROJ: { epicLinkField: 'customfield_10008' } },
  writeProjects: ['PROJ'],
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
  const WRITE_TOOL_NAMES = ['create_issue', 'add_comment', 'transition_issue', 'assign_to_epic']
  const withWrite = setup()
  for (const name of WRITE_TOOL_NAMES) {
    assert.ok(withWrite.has(name), `${name} should be registered`)
  }
  const readOnly = setup({ config: { ...CONFIG, allowWrite: false } })
  for (const name of WRITE_TOOL_NAMES) {
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

test('create_issue: bracketed titles survive the duplicate check (Lucene specials sanitized)', async () => {
  let jqlUsed = null
  const tools = setup({
    client: {
      searchIssues: async (_config, { jql }) => {
        jqlUsed = jql
        return { issues: [{ key: 'PROJ-9', fields: { summary: '[iOS] Wylogowanie użytkownika', status: { name: 'To Do' } } }], total: 1, startAt: 0 }
      },
      createIssue: async () => ({ key: 'PROJ-999' }),
    },
  })
  const result = await tools.get('create_issue').handler({
    project: 'PROJ', issue_type: 'Task', summary: '[iOS] Wylogowanie użytkownika',
  })
  assert.ok(!jqlUsed.includes('['), `JQL operand must not contain "[", got: ${jqlUsed}`)
  assert.equal(result.isError, true, 'exact bracketed duplicate must still be detected')
  assert.match(result.content[0].text, /PROJ-9/)
})

test('create_issue: a failing duplicate CHECK does not block creation', async () => {
  const tools = setup({
    client: {
      searchIssues: async () => { throw new JiraError('Jira zwróciła błąd 400: range query incorrect') },
      createIssue: async () => ({ key: 'PROJ-999' }),
    },
  })
  const result = await tools.get('create_issue').handler({
    project: 'PROJ', issue_type: 'Task', summary: 'Zupełnie nowy temat',
  })
  assert.equal(result.isError, undefined)
  assert.match(result.content[0].text, /PROJ-999/)
})

test('create_issue: sprint_id lands in the Sprint field from the profile', async () => {
  let sent = null
  const tools = setup({
    config: { ...CONFIG, projects: { PROJ: { sprintField: 'customfield_10020', allowWrite: true } } },
    client: { createIssue: async (_config, fields) => { sent = fields; return { key: 'PROJ-100' } } },
  })
  const result = await tools.get('create_issue').handler({
    project: 'PROJ', issue_type: 'Task', summary: 'Ticket w sprincie', sprint_id: 1451,
  })
  assert.equal(result.isError, undefined)
  assert.equal(sent.customfield_10020, 1451)
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

// --- per-project write opt-in ---------------------------------------------------

test('global gate re-checked per call: flipping allowWrite to false blocks a running server', async () => {
  let current = CONFIG
  const tools = new Map()
  const server = { registerTool: (name, cfg, handler) => tools.set(name, { cfg, handler }) }
  registerTools(server, {
    getConfig: () => current,
    client: { ...NO_DUPLICATES, createIssue: async () => ({ key: 'PROJ-1' }) },
  })
  assert.ok(tools.has('create_issue'), 'registered while allowWrite was true')

  current = { ...CONFIG, allowWrite: false }
  const result = await tools.get('create_issue').handler({
    project: 'PROJ', issue_type: 'Task', summary: 'Brand new work item',
  })
  assert.equal(result.isError, true)
  assert.match(result.content[0].text, /Tryb zapisu jest wyłączony/)
})

test('per-project gate: project without opt-in is refused even in write mode', async () => {
  let posted = false
  const tools = setup({
    config: { ...CONFIG, writeProjects: [] },
    client: { createIssue: async () => { posted = true; return { key: 'PROJ-1' } } },
  })
  const result = await tools.get('create_issue').handler({
    project: 'PROJ', issue_type: 'Task', summary: 'Brand new work item',
  })
  assert.equal(result.isError, true)
  assert.match(result.content[0].text, /Zapis do projektu PROJ nie jest włączony/)
  assert.equal(posted, false)
})

test('per-project gate: profile allowWrite=true unlocks the project', async () => {
  const tools = setup({
    config: { ...CONFIG, writeProjects: [], projects: { PROJ: { allowWrite: true } } },
    client: { createIssue: async () => ({ key: 'PROJ-2' }) },
  })
  const result = await tools.get('create_issue').handler({
    project: 'PROJ', issue_type: 'Task', summary: 'Brand new work item',
  })
  assert.equal(result.isError, undefined)
})

test('per-project gate: add_comment and transition derive the project from the key', async () => {
  const tools = setup({
    config: { ...CONFIG, writeProjects: ['PROJ'] },
    client: {
      addComment: async () => ({}),
      listTransitions: async () => ({ transitions: [{ id: '1', name: 'Done' }] }),
      doTransition: async () => null,
    },
  })
  const comment = await tools.get('add_comment').handler({ key: 'OTHER-5', body: 'x' })
  assert.equal(comment.isError, true)
  assert.match(comment.content[0].text, /Zapis do projektu OTHER nie jest włączony/)

  const transition = await tools.get('transition_issue').handler({ key: 'OTHER-5', transition_name: 'Done' })
  assert.equal(transition.isError, true)

  const allowed = await tools.get('add_comment').handler({ key: 'PROJ-5', body: 'x' })
  assert.equal(allowed.isError, undefined)
})

// --- AI transparency marking ------------------------------------------------------

test('create_issue: aiLabel on (default) adds the ai-generated label without duplicating', async () => {
  const sent = []
  const tools = setup({
    config: { ...CONFIG, aiLabel: true },
    client: { createIssue: async (_config, fields) => { sent.push(fields); return { key: 'PROJ-1' } } },
  })
  await tools.get('create_issue').handler({ project: 'PROJ', issue_type: 'Task', summary: 'Fresh work item' })
  assert.deepEqual(sent[0].labels, ['ai-generated'])

  await tools.get('create_issue').handler({
    project: 'PROJ', issue_type: 'Task', summary: 'Another work item', labels: ['mobile', 'ai-generated'],
  })
  assert.deepEqual(sent[1].labels, ['mobile', 'ai-generated'])
})

test('create_issue: aiLabel=false adds nothing', async () => {
  let sent = null
  const tools = setup({
    client: { createIssue: async (_config, fields) => { sent = fields; return { key: 'PROJ-1' } } },
  })
  await tools.get('create_issue').handler({ project: 'PROJ', issue_type: 'Task', summary: 'Fresh work item' })
  assert.equal(sent.labels, undefined)
})

test('add_comment: aiLabel on appends the signature, off leaves the body untouched', async () => {
  const bodies = []
  const client = { addComment: async (_config, _key, body) => { bodies.push(body); return {} } }

  const marked = setup({ config: { ...CONFIG, aiLabel: true }, client })
  await marked.get('add_comment').handler({ key: 'PROJ-42', body: 'Retest proszę' })
  assert.equal(bodies[0], 'Retest proszę\n\n_(ai-generated · jira-tools)_')

  const plain = setup({ client })
  await plain.get('add_comment').handler({ key: 'PROJ-42', body: 'Retest proszę' })
  assert.equal(bodies[1], 'Retest proszę')
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

// --- assign_to_epic --------------------------------------------------------------

test('assign_to_epic: expands ranges and posts the full list to the epic', async () => {
  let sent = null
  const tools = setup({
    client: { addIssuesToEpic: async (_config, epic, issues) => { sent = { epic, issues }; return null } },
  })
  const result = await tools.get('assign_to_epic').handler({
    epic_key: 'proj-200', keys: ['PROJ-101', 'proj-105..107'],
  })
  assert.equal(result.isError, undefined)
  assert.deepEqual(sent, { epic: 'PROJ-200', issues: ['PROJ-101', 'PROJ-105', 'PROJ-106', 'PROJ-107'] })
  assert.match(result.content[0].text, /Przypisano 4 zadań do epica PROJ-200/)
})

test('assign_to_epic: refuses when any affected project lacks the write opt-in', async () => {
  let posted = false
  const tools = setup({
    client: { addIssuesToEpic: async () => { posted = true; return null } },
  })
  const result = await tools.get('assign_to_epic').handler({
    epic_key: 'PROJ-200', keys: ['OTHER-1'],
  })
  assert.equal(result.isError, true)
  assert.match(result.content[0].text, /Zapis do projektu OTHER nie jest włączony/)
  assert.equal(posted, false)
})

test('assign_to_epic: every issue consumes the write budget before the POST', async () => {
  let posted = false
  const tools = setup({
    config: { ...CONFIG, writeBudget: { creates: 10, total: 3 } },
    client: { addIssuesToEpic: async () => { posted = true; return null } },
  })
  const result = await tools.get('assign_to_epic').handler({
    epic_key: 'PROJ-200', keys: ['PROJ-101..110'],
  })
  assert.equal(result.isError, true)
  assert.match(result.content[0].text, /Limit zapisów/)
  assert.equal(posted, false, 'budget must stop the call before any HTTP')
})

test('assign_to_epic: caps the number of keys per call', async () => {
  const tools = setup({ client: { addIssuesToEpic: async () => null } })
  const result = await tools.get('assign_to_epic').handler({
    epic_key: 'PROJ-200', keys: ['PROJ-1..30'],
  })
  assert.equal(result.isError, true)
  assert.match(result.content[0].text, /limit 20/)
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
