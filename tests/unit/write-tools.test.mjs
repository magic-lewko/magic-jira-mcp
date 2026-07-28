import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { registerTools } from '../../plugins/jira-tools/src/server.mjs'
import { JiraError } from '../../plugins/jira-tools/src/jira-client.mjs'
import { resetWriteBudget, consumeWriteBudget, DEFAULT_WRITE_BUDGET } from '../../plugins/jira-tools/src/write-guard.mjs'

const CONFIG = {
  server: 'https://jira.example.pl',
  token: 't',
  projects: { PROJ: { epicLinkField: 'customfield_10008' } },
  writeBudget: { creates: 10, total: 30 },
}

/** No duplicates anywhere, unless a test overrides searchIssues. */
const NO_DUPLICATES = { searchIssues: async () => ({ issues: [], total: 0, startAt: 0 }) }

beforeEach(() => resetWriteBudget())

/** Register everything and return the tool map. */
function setup({ client = {}, config = CONFIG } = {}) {
  const tools = new Map()
  const server = { registerTool: (name, cfg, handler) => tools.set(name, { cfg, handler }) }
  registerTools(server, { getConfig: () => config, client: { ...NO_DUPLICATES, ...client } })
  return tools
}

// --- registration ------------------------------------------------------------

test('all write tools are registered (no write-mode gate)', () => {
  const tools = setup()
  for (const name of ['create_issue', 'update_issue', 'add_comment', 'add_attachment', 'transition_issue', 'assign_to_epic', 'link_issues']) {
    assert.ok(tools.has(name), `${name} should be registered`)
  }
})

// --- create_issue ------------------------------------------------------------

test('create_issue: builds correct POST fields, always adds ai-generated', async () => {
  let sent = null
  const tools = setup({
    client: { createIssue: async (_config, fields) => { sent = fields; return { key: 'PROJ-100' } } },
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
  assert.match(result.content[0].text, /Utworzono PROJ-100/)
  assert.deepEqual(sent, {
    project: { key: 'PROJ' },
    issuetype: { name: 'Task' },
    summary: 'Logout flow on iOS',
    description: 'desc',
    components: [{ name: 'iOS' }],
    labels: ['mobile', 'ai-generated'],
    assignee: { name: 'jkowalski' },
    customfield_10008: 'PROJ-40',
  })
})

test('create_issue: ai-generated added once even if caller passed it', async () => {
  let sent = null
  const tools = setup({
    client: { createIssue: async (_config, fields) => { sent = fields; return { key: 'PROJ-1' } } },
  })
  await tools.get('create_issue').handler({
    project: 'PROJ', issue_type: 'Task', summary: 'Fresh item', labels: ['ai-generated', 'x'],
  })
  assert.deepEqual(sent.labels, ['ai-generated', 'x'])
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

test('create_issue: sprint_id lands in the Sprint field from the profile', async () => {
  let sent = null
  const tools = setup({
    config: { ...CONFIG, projects: { PROJ: { sprintField: 'customfield_10020' } } },
    client: { createIssue: async (_config, fields) => { sent = fields; return { key: 'PROJ-100' } } },
  })
  await tools.get('create_issue').handler({
    project: 'PROJ', issue_type: 'Task', summary: 'Ticket w sprincie', sprint_id: 1451,
  })
  assert.equal(sent.customfield_10020, 1451)
})

test('create_issue: refuses an open duplicate and returns the existing key', async () => {
  let posted = false
  const tools = setup({
    client: {
      searchIssues: async () => ({
        issues: [{ key: 'PROJ-7', fields: { summary: '  logout   flow on iOS ', status: { name: 'To Do' } } }],
        total: 1, startAt: 0,
      }),
      createIssue: async () => { posted = true; return { key: 'PROJ-999' } },
    },
  })
  const result = await tools.get('create_issue').handler({
    project: 'PROJ', issue_type: 'Task', summary: 'Logout flow on iOS',
  })
  assert.equal(result.isError, true)
  assert.match(result.content[0].text, /PROJ-7/)
  assert.equal(posted, false)
})

test('create_issue: bracketed titles survive the duplicate check', async () => {
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
  assert.equal(result.isError, true)
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

// --- AI transparency (always on) ---------------------------------------------

test('add_comment: always appends the ai-generated signature', async () => {
  const bodies = []
  const tools = setup({ client: { addComment: async (_config, _key, body) => { bodies.push(body); return {} } } })
  await tools.get('add_comment').handler({ key: 'PROJ-42', body: 'Retest proszę' })
  assert.equal(bodies[0], 'Retest proszę\n\n_(ai-generated · jira-tools)_')
})

// --- update_issue ------------------------------------------------------------

test('update_issue: assignee, priority and components map to Jira field shapes', async () => {
  let sent = null
  const tools = setup({ client: { updateIssue: async (_config, key, fields) => { sent = { key, fields }; return null } } })
  const result = await tools.get('update_issue').handler({
    key: 'proj-42', assignee: 'mkurzempa', priority: 'High', components: ['Frontend'],
  })
  assert.equal(result.isError, undefined)
  assert.deepEqual(sent, {
    key: 'PROJ-42',
    fields: { assignee: { name: 'mkurzempa' }, priority: { name: 'High' }, components: [{ name: 'Frontend' }] },
  })
})

test('update_issue: "unassigned" clears the assignee', async () => {
  let sent = null
  const tools = setup({ client: { updateIssue: async (_config, _key, fields) => { sent = fields; return null } } })
  await tools.get('update_issue').handler({ key: 'PROJ-42', assignee: 'unassigned' })
  assert.deepEqual(sent.assignee, { name: null })
})

test('update_issue: add_labels merges with existing labels', async () => {
  let sent = null
  const tools = setup({
    client: {
      getIssue: async () => ({ key: 'PROJ-42', fields: { labels: ['UAT', 'mobile'] } }),
      updateIssue: async (_config, _key, fields) => { sent = fields; return null },
    },
  })
  await tools.get('update_issue').handler({ key: 'PROJ-42', add_labels: ['regression', 'UAT'] })
  assert.deepEqual(sent.labels, ['UAT', 'mobile', 'regression'])
})

test('update_issue: labels alone replaces the whole list', async () => {
  let sent = null
  const tools = setup({ client: { updateIssue: async (_config, _key, fields) => { sent = fields; return null } } })
  await tools.get('update_issue').handler({ key: 'PROJ-42', labels: ['only-this'] })
  assert.deepEqual(sent.labels, ['only-this'])
})

test('update_issue: no fields → readable error, nothing sent', async () => {
  let called = false
  const tools = setup({ client: { updateIssue: async () => { called = true; return null } } })
  const result = await tools.get('update_issue').handler({ key: 'PROJ-42' })
  assert.equal(result.isError, true)
  assert.match(result.content[0].text, /Nie podano żadnego pola/)
  assert.equal(called, false)
})

test('update_issue: budget stops further writes once exhausted', async () => {
  const tools = setup({ config: { ...CONFIG, writeBudget: { creates: 10, total: 1 } }, client: { updateIssue: async () => null } })
  assert.equal((await tools.get('update_issue').handler({ key: 'PROJ-1', assignee: 'x' })).isError, undefined)
  const exhausted = await tools.get('update_issue').handler({ key: 'PROJ-2', assignee: 'x' })
  assert.equal(exhausted.isError, true)
  assert.match(exhausted.content[0].text, /Limit zapisów/)
})

// --- add_attachment ----------------------------------------------------------

test('add_attachment: uploads an existing file with its name and size', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jira-attach-'))
  const file = join(dir, 'screenshot.png')
  writeFileSync(file, Buffer.alloc(2048, 7))
  let sent = null
  try {
    const tools = setup({ client: { addAttachment: async (_config, key, payload) => { sent = { key, payload }; return [{}] } } })
    const result = await tools.get('add_attachment').handler({ key: 'proj-42', path: file })
    assert.equal(result.isError, undefined)
    assert.equal(sent.key, 'PROJ-42')
    assert.equal(sent.payload.filename, 'screenshot.png')
    assert.equal(sent.payload.bytes.length, 2048)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('add_attachment: missing file → readable error, nothing uploaded', async () => {
  let called = false
  const tools = setup({ client: { addAttachment: async () => { called = true; return [{}] } } })
  const result = await tools.get('add_attachment').handler({ key: 'PROJ-42', path: join(tmpdir(), 'nie-ma-12345.png') })
  assert.equal(result.isError, true)
  assert.match(result.content[0].text, /Nie znaleziono pliku/)
  assert.equal(called, false)
})

// --- assign_to_epic ----------------------------------------------------------

test('assign_to_epic: expands ranges and posts the full list to the epic', async () => {
  let sent = null
  const tools = setup({ client: { addIssuesToEpic: async (_config, epic, issues) => { sent = { epic, issues }; return null } } })
  const result = await tools.get('assign_to_epic').handler({ epic_key: 'proj-200', keys: ['PROJ-101', 'proj-105..107'] })
  assert.equal(result.isError, undefined)
  assert.deepEqual(sent, { epic: 'PROJ-200', issues: ['PROJ-101', 'PROJ-105', 'PROJ-106', 'PROJ-107'] })
})

test('assign_to_epic: budget stops the call before any HTTP', async () => {
  let posted = false
  const tools = setup({ config: { ...CONFIG, writeBudget: { creates: 10, total: 3 } }, client: { addIssuesToEpic: async () => { posted = true; return null } } })
  const result = await tools.get('assign_to_epic').handler({ epic_key: 'PROJ-200', keys: ['PROJ-101..110'] })
  assert.equal(result.isError, true)
  assert.match(result.content[0].text, /Limit zapisów/)
  assert.equal(posted, false)
})

test('assign_to_epic: caps the number of keys per call', async () => {
  const tools = setup({ client: { addIssuesToEpic: async () => null } })
  const result = await tools.get('assign_to_epic').handler({ epic_key: 'PROJ-200', keys: ['PROJ-1..30'] })
  assert.equal(result.isError, true)
  assert.match(result.content[0].text, /limit 20/)
})

// --- link_issues -------------------------------------------------------------

const LINK_TYPES = { issueLinkTypes: [{ name: 'Relates' }, { name: 'Blocks' }, { name: 'Duplicate' }] }

test('link_issues: links source to each target with default Relates', async () => {
  const links = []
  const tools = setup({
    client: {
      listIssueLinkTypes: async () => LINK_TYPES,
      linkIssues: async (_config, link) => { links.push(link); return null },
    },
  })
  const result = await tools.get('link_issues').handler({ from: 'proj-1', to: ['PROJ-2', 'proj-3..4'] })
  assert.equal(result.isError, undefined)
  assert.deepEqual(links, [
    { type: 'Relates', from: 'PROJ-1', to: 'PROJ-2' },
    { type: 'Relates', from: 'PROJ-1', to: 'PROJ-3' },
    { type: 'Relates', from: 'PROJ-1', to: 'PROJ-4' },
  ])
})

test('link_issues: matches type case-insensitively', async () => {
  let used = null
  const tools = setup({
    client: { listIssueLinkTypes: async () => LINK_TYPES, linkIssues: async (_config, link) => { used = link.type; return null } },
  })
  await tools.get('link_issues').handler({ from: 'PROJ-1', to: ['PROJ-2'], type: 'blocks' })
  assert.equal(used, 'Blocks')
})

test('link_issues: unknown type lists the available ones and links nothing', async () => {
  let linked = false
  const tools = setup({
    client: { listIssueLinkTypes: async () => LINK_TYPES, linkIssues: async () => { linked = true; return null } },
  })
  const result = await tools.get('link_issues').handler({ from: 'PROJ-1', to: ['PROJ-2'], type: 'Zależy' })
  assert.equal(result.isError, true)
  assert.match(result.content[0].text, /Dostępne: "Relates", "Blocks", "Duplicate"/)
  assert.equal(linked, false)
})

test('link_issues: drops the source key from targets and rejects an empty set', async () => {
  const tools = setup({ client: { listIssueLinkTypes: async () => LINK_TYPES, linkIssues: async () => null } })
  const result = await tools.get('link_issues').handler({ from: 'PROJ-1', to: ['PROJ-1'] })
  assert.equal(result.isError, true)
  assert.match(result.content[0].text, /co najmniej jedno zadanie docelowe/)
})

// --- add_comment / transition ------------------------------------------------

test('add_comment: posts (with signature) and returns the browse URL', async () => {
  let posted = null
  const tools = setup({ client: { addComment: async (_config, key, body) => { posted = { key, body }; return {} } } })
  const result = await tools.get('add_comment').handler({ key: 'proj-42', body: 'Deployed to UAT' })
  assert.equal(posted.key, 'PROJ-42')
  assert.match(posted.body, /Deployed to UAT/)
  assert.match(posted.body, /ai-generated · jira-tools/)
  assert.match(result.content[0].text, /Dodano komentarz do PROJ-42/)
})

test('transition_issue: matches case-insensitively and reports the target status', async () => {
  let transitioned = null
  const tools = setup({
    client: {
      listTransitions: async () => ({ transitions: [{ id: '11', name: 'In Progress', to: { name: 'In Progress' } }, { id: '21', name: 'Done', to: { name: 'Done' } }] }),
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

// --- session write budget ----------------------------------------------------

test('budget: creates limit stops further create_issue calls', async () => {
  const config = { ...CONFIG, writeBudget: { creates: 2, total: 30 } }
  const tools = setup({ config, client: { createIssue: async () => ({ key: 'PROJ-1' }) } })
  const create = (n) => tools.get('create_issue').handler({ project: 'PROJ', issue_type: 'Task', summary: `Unique ticket ${n}` })
  assert.equal((await create(1)).isError, undefined)
  assert.equal((await create(2)).isError, undefined)
  const third = await create(3)
  assert.equal(third.isError, true)
  assert.match(third.content[0].text, /Limit zapisów w tej sesji osiągnięty \(2\/2/)
})

test('budget: total limit covers comments and transitions too', () => {
  const config = { writeBudget: { creates: 10, total: 2 } }
  consumeWriteBudget(config, 'write')
  consumeWriteBudget(config, 'write')
  assert.throws(() => consumeWriteBudget(config, 'write'), JiraError)
})

test('budget: defaults applied when config has none', () => {
  for (let i = 0; i < DEFAULT_WRITE_BUDGET.creates; i++) consumeWriteBudget({}, 'create')
  assert.throws(() => consumeWriteBudget({}, 'create'), /10\/10/)
})
