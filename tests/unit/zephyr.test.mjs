import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

import { registerTools } from '../../plugins/jira-tools/src/server.mjs'
import {
  JiraError, searchExecutions, createExecution, getTestSteps, updateExecutionStatus, listTestCycles,
} from '../../plugins/jira-tools/src/jira-client.mjs'
import { resetWriteBudget, consumeWriteBudget } from '../../plugins/jira-tools/src/write-guard.mjs'
import { cyclesFromResponse, toZephyrDate, resolveExecutionStatus } from '../../plugins/jira-tools/src/zephyr.mjs'

const CONFIG = { server: 'https://jira.example.pl', token: 'secret-token', projects: {}, writeBudget: { creates: 10, total: 30 } }

const STATUSES = [
  { id: 1, name: 'PASS' }, { id: 2, name: 'FAIL' }, { id: 3, name: 'WIP' }, { id: 4, name: 'BLOCKED' }, { id: -1, name: 'UNEXECUTED' },
]

const PROJECT = {
  id: '10001',
  key: 'PROJ',
  issueTypes: [
    { name: 'Story', subtask: false },
    { name: 'Test', subtask: false, description: 'This Issue Type is used to create Zephyr Test within Jira.' },
  ],
}

const TEST_TYPE = { name: 'Test', subtask: false, description: 'Zephyr Test' }

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })
beforeEach(() => resetWriteBudget())

/** Install a fetch mock returning queued responses; records requests. */
function mockFetch(responses) {
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init })
    const next = responses.shift()
    if (!next) throw new Error('mockFetch: no response queued')
    return {
      ok: next.status < 400,
      status: next.status,
      text: async () => (typeof next.body === 'string' ? next.body : JSON.stringify(next.body)),
    }
  }
  return calls
}

/** Register everything against a fake client and return the tool map. */
function setup(client = {}, config = CONFIG) {
  const tools = new Map()
  const server = { registerTool: (name, cfg, handler) => tools.set(name, { cfg, handler }) }
  const base = {
    searchIssues: async () => ({ issues: [], total: 0, startAt: 0 }),
    getProject: async () => PROJECT,
    listExecutionStatuses: async () => STATUSES,
    getProjectProperty: async () => null,
  }
  registerTools(server, { getConfig: () => config, client: { ...base, ...client } })
  return tools
}

/** Text of a tool result. */
const text = (result) => result.content[0].text

// --- client ------------------------------------------------------------------

test('searchExecutions pages by absolute offset until the total', async () => {
  const calls = mockFetch([
    { status: 200, body: { executions: [{ id: 1 }, { id: 2 }], totalCount: 3 } },
    { status: 200, body: { executions: [{ id: 3 }], totalCount: 3 } },
  ])
  const page = await searchExecutions(CONFIG, { zql: 'cycleId = 7', limit: 10 })
  assert.deepEqual(page.executions.map((e) => e.id), [1, 2, 3])
  assert.equal(page.total, 3)
  assert.match(calls[0].url, /\/rest\/zapi\/latest\/zql\/executeSearch\?zqlQuery=cycleId\+%3D\+7&offset=0&maxRecords=10/)
  assert.match(calls[1].url, /offset=2&maxRecords=8/)
  assert.equal(calls[0].init.headers.Authorization, 'Bearer secret-token')
})

test('a ZAPI failure sent as HTTP 200 surfaces as a JiraError', async () => {
  mockFetch([{ status: 200, body: { errorDesc: 'You do not have the permission', errorId: 'ERROR' } }])
  await assert.rejects(() => listTestCycles(CONFIG, 10001), (err) => {
    assert.ok(err instanceof JiraError)
    assert.match(err.message, /Zephyr refused .*permission/)
    return true
  })
})

test('createExecution unwraps the map keyed by execution id and sends string ids', async () => {
  const calls = mockFetch([{ status: 200, body: { 555: { id: 555, issueKey: 'PROJ-30' } } }])
  const execution = await createExecution(CONFIG, { issueId: 9, cycleId: 7, projectId: '10001', versionId: -1 })
  assert.equal(execution.id, 555)
  assert.deepEqual(JSON.parse(calls[0].init.body), { issueId: '9', cycleId: '7', projectId: '10001', versionId: '-1' })
})

test('getTestSteps reads stepBeanCollection and plain arrays', async () => {
  mockFetch([
    { status: 200, body: { stepBeanCollection: [{ id: 1, step: 'a' }] } },
    { status: 200, body: [{ id: 2, step: 'b' }] },
  ])
  assert.equal((await getTestSteps(CONFIG, 9))[0].step, 'a')
  assert.equal((await getTestSteps(CONFIG, 9))[0].step, 'b')
})

test('updateExecutionStatus sends a numeric status and the comment only when given', async () => {
  const calls = mockFetch([{ status: 200, body: {} }, { status: 200, body: {} }])
  await updateExecutionStatus(CONFIG, 5, { status: '2', comment: 'broken' })
  await updateExecutionStatus(CONFIG, 5, { status: 1 })
  assert.equal(calls[0].init.method, 'PUT')
  assert.match(calls[0].url, /\/execution\/5\/execute$/)
  assert.deepEqual(JSON.parse(calls[0].init.body), { status: 2, comment: 'broken' })
  assert.deepEqual(JSON.parse(calls[1].init.body), { status: 1 })
})

// --- helpers -----------------------------------------------------------------

test('cyclesFromResponse flattens both listing shapes and drops an empty Ad hoc', () => {
  const flat = { '-1': { name: 'Ad hoc', totalExecutions: 0 }, 70: { name: 'Release 12' }, recordsCount: 2 }
  const nested = { '-1': [{ 70: { name: 'Release 12' }, recordsCount: 1 }], 2001: [{ 400: { name: 'Release 13' } }] }
  assert.deepEqual(cyclesFromResponse(flat).map((c) => [c.id, c.name]), [[70, 'Release 12']])
  assert.deepEqual(cyclesFromResponse(nested).map((c) => [c.id, c.name]), [[400, 'Release 13'], [70, 'Release 12']])
  assert.deepEqual(cyclesFromResponse({}), [])
})

test('toZephyrDate converts YYYY-MM-DD and rejects impossible dates', () => {
  assert.equal(toZephyrDate('2026-12-01', 'start_date'), '1/Dec/26')
  assert.equal(toZephyrDate('2024-07-15', 'start_date'), '15/Jul/24')
  assert.throws(() => toZephyrDate('2026-02-30', 'end_date'), /end_date must be a date/)
  assert.throws(() => toZephyrDate('01/12/2026', 'start_date'), /YYYY-MM-DD/)
})

test('resolveExecutionStatus matches names case-insensitively and lists the options', () => {
  assert.equal(resolveExecutionStatus(STATUSES, 'fail').id, 2)
  assert.equal(resolveExecutionStatus(STATUSES, '-1').name, 'UNEXECUTED')
  assert.throws(() => resolveExecutionStatus(STATUSES, 'passed'), /Available: PASS, FAIL/)
})

// --- read tools --------------------------------------------------------------

test('list_test_cycles lists cycles with progress and status counts', async () => {
  let called = false
  const tools = setup({
    listTestCycles: async () => ({
      70: {
        name: 'Release 12', versionName: 'Unscheduled', environment: 'UAT', totalExecutions: 22, totalExecuted: 2, totalFolders: 2, versionId: -1,
        executionSummaries: { executionSummary: [{ statusName: 'UNEXECUTED', count: 20 }, { statusName: 'PASS', count: 2 }, { statusName: 'FAIL', count: 0 }] },
      },
      recordsCount: 1,
    }),
    listCycleFolders: async () => { called = true; return [] },
  })
  const out = text(await tools.get('list_test_cycles').handler({ project: 'proj' }))
  assert.match(out, /Test cycles in PROJ \(1, newest first\):/)
  assert.match(out, /#70 Release 12 · version: Unscheduled · env: UAT · executed 2\/22 · folders: 2 \(UNEXECUTED 20 · PASS 2\)$/)
  assert.equal(called, false)
})

test('listTestCycles asks Zephyr for the execution summaries', async () => {
  const calls = mockFetch([{ status: 200, body: {} }])
  await listTestCycles(CONFIG, 10001, { versionId: -1 })
  assert.match(calls[0].url, /\/cycle\?projectId=10001&versionId=-1&expand=executionSummaries$/)
})

test('list_test_cycles with cycle_id shows status counts and folders', async () => {
  const tools = setup({
    getTestCycle: async () => ({ name: 'Release 12', projectId: 10001, versionId: -1, versionName: 'Unscheduled' }),
    listCycleFolders: async () => [{ folderId: 12, folderName: 'Login', totalExecutions: 2, totalExecuted: 1 }],
    searchExecutions: async () => ({
      executions: [
        { id: 1, executionStatus: '1', status: { name: 'PASS' } },
        { id: 2, executionStatus: '-1', status: { name: 'UNEXECUTED' } },
      ],
      total: 2,
    }),
  })
  const out = text(await tools.get('list_test_cycles').handler({ project: 'PROJ', cycle_id: 70 }))
  assert.match(out, /#70 Release 12 .* executed 1\/2 · folders: 1/)
  assert.match(out, /Statuses: PASS 1 · UNEXECUTED 1/)
  assert.match(out, /- #12 Login · executed 1\/2/)
})

test('search_test_executions formats lines, counts statuses and notes truncation', async () => {
  let asked
  const tools = setup({
    searchExecutions: async (_config, params) => {
      asked = params
      return {
        executions: [{
          id: 9001, status: { name: 'FAIL' }, issueKey: 'PROJ-41', issueSummary: 'Default list',
          cycleName: 'Release 12', folderName: 'Lists', versionName: 'Unscheduled', executedByDisplay: 'Tester', executedOn: '3/Jul/24',
          totalDefectCount: 1, comment: 'button missing',
        }],
        total: 4,
      }
    },
  })
  const out = text(await tools.get('search_test_executions').handler({ zql: ' cycleName = "Release 12" ', max_results: 1 }))
  assert.deepEqual(asked, { zql: 'cycleName = "Release 12"', limit: 1 })
  assert.match(out, /#9001 FAIL PROJ-41 — Default list · Release 12 \/ Lists · Unscheduled · by Tester 3\/Jul\/24 · defects: 1 · comment: "button missing"/)
  assert.match(out, /Statuses \(1 of 4 shown\): FAIL 1/)
  assert.match(out, /\(showing 1 of 4 — narrow the ZQL or raise max_results\)/)
})

test('get_test_case shows steps and executions, refuses a non-test issue', async () => {
  const tools = setup({
    getIssue: async (_config, key) => (key === 'PROJ-450'
      ? { id: '5001', key, fields: { summary: 'Duplicate a list', issuetype: TEST_TYPE, status: { name: 'Open' } } }
      : { id: '1', key, fields: { summary: 'Story', issuetype: { name: 'Story' } } }),
    getTestSteps: async (_config, issueId) => {
      assert.equal(issueId, '5001')
      return [{ orderId: 1, step: 'Open the lists', data: '', result: '' }, { orderId: 2, step: 'Tap Duplicate', data: 'max name', result: 'Error shown' }]
    },
    searchExecutions: async (_config, { zql }) => {
      assert.match(zql, /^issue = PROJ-450/)
      return { executions: [{ id: 9, status: { name: 'PASS' }, issueKey: 'PROJ-450', cycleName: 'Release 12' }], total: 1 }
    },
  })
  const out = text(await tools.get('get_test_case').handler({ key: 'proj-450' }))
  assert.match(out, /STEPS \(2\):\n1\. Open the lists\n2\. Tap Duplicate\n {3}Data: max name\n {3}Expected: Error shown/)
  assert.match(out, /EXECUTIONS \(1\):\n#9 PASS PROJ-450/)
  const refused = await tools.get('get_test_case').handler({ key: 'PROJ-1' })
  assert.equal(refused.isError, true)
  assert.match(text(refused), /PROJ-1 is a Story, not a Zephyr test/)
})

// --- create_test_cases -------------------------------------------------------

test('create_test_cases creates Test issues in one bulk call, then their steps', async () => {
  let payload
  const steps = []
  const tools = setup({
    createIssuesBulk: async (_config, fieldsList) => {
      payload = fieldsList
      return { issues: [{ id: '501', key: 'PROJ-30' }, { id: '502', key: 'PROJ-31' }], errors: [] }
    },
    addTestStep: async (_config, issueId, step) => { steps.push([issueId, step]); return {} },
  })
  const out = text(await tools.get('create_test_cases').handler({
    project: 'proj',
    items: [
      { summary: 'Login with valid data', steps: [{ step: 'Open login', result: 'Form shown' }, { step: 'Submit', data: 'demo' }] },
      { summary: 'Login with a wrong password', labels: ['regression'] },
    ],
  }))
  assert.equal(payload.length, 2)
  assert.deepEqual(payload[0].issuetype, { name: 'Test' })
  assert.deepEqual(payload[0].labels, ['ai-generated'])
  assert.deepEqual(payload[1].labels, ['regression', 'ai-generated'])
  assert.deepEqual(steps, [
    ['501', { step: 'Open login', data: '', result: 'Form shown' }],
    ['501', { step: 'Submit', data: 'demo', result: '' }],
  ])
  assert.match(out, /Created 2\/2 test cases in PROJ:/)
  assert.match(out, /- PROJ-30 "Login with valid data" · 2\/2 steps/)
  assert.match(out, /- PROJ-31 "Login with a wrong password" · no steps/)
})

test('create_test_cases refuses up front when tests + steps do not fit the budget', async () => {
  let created = false
  const tools = setup({ createIssuesBulk: async () => { created = true; return { issues: [] } } }, {
    ...CONFIG, writeBudget: { creates: 10, total: 3 },
  })
  const result = await tools.get('create_test_cases').handler({
    project: 'PROJ',
    items: [{ summary: 'Login with valid data', steps: [{ step: 'a' }, { step: 'b' }, { step: 'c' }] }],
  })
  assert.equal(result.isError, true)
  assert.match(text(result), /write limit would be exceeded/)
  assert.equal(created, false)
})

test('create_test_cases refuses a project without the Zephyr Test type', async () => {
  const tools = setup({ getProject: async () => ({ id: '1', issueTypes: [{ name: 'Story' }, { name: 'Bug' }] }) })
  const result = await tools.get('create_test_cases').handler({ project: 'PROJ', items: [{ summary: 'Login with valid data' }] })
  assert.equal(result.isError, true)
  assert.match(text(result), /no Zephyr "Test" issue type.*Story, Bug/)
})

test('create_test_cases blocks an open duplicate and a repeat inside the batch', async () => {
  const tools = setup({
    searchIssues: async () => ({ issues: [{ key: 'PROJ-9', fields: { summary: 'Login with valid data' } }], total: 1 }),
  })
  const dup = await tools.get('create_test_cases').handler({ project: 'PROJ', items: [{ summary: 'Login  with valid DATA' }] })
  assert.match(text(dup), /Nothing created — item 1 .* duplicates PROJ-9/)
  const repeat = setup()
  const twice = await repeat.get('create_test_cases').handler({
    project: 'PROJ', items: [{ summary: 'Logout works' }, { summary: 'logout works' }],
  })
  assert.match(text(twice), /item 2 .* repeats an earlier item/)
})

test('create_test_cases reports a failing step and stops that test', async () => {
  const tools = setup({
    createIssuesBulk: async () => ({ issues: [{ id: '501', key: 'PROJ-30' }], errors: [] }),
    addTestStep: async (_config, _id, step) => {
      if (step.step === 'b') throw new JiraError('Jira returned error 500')
      return {}
    },
  })
  const out = text(await tools.get('create_test_cases').handler({
    project: 'PROJ', items: [{ summary: 'Login with valid data', steps: [{ step: 'a' }, { step: 'b' }, { step: 'c' }] }],
  }))
  assert.match(out, /PROJ-30 "Login with valid data" · 1\/3 steps — step 2 FAILED: Jira returned error 500/)
  assert.match(out, /add_test_steps/)
})

test('add_test_steps appends to a test and refuses other issue types', async () => {
  const added = []
  const tools = setup({
    getIssue: async (_config, key) => ({ id: key === 'PROJ-30' ? '501' : '1', fields: { issuetype: key === 'PROJ-30' ? TEST_TYPE : { name: 'Bug' } } }),
    addTestStep: async (_config, id, step) => { added.push([id, step.step]); return {} },
  })
  const out = text(await tools.get('add_test_steps').handler({ key: 'proj-30', steps: [{ step: 'x' }, { step: 'y' }] }))
  assert.match(out, /Added 2\/2 steps to PROJ-30/)
  assert.deepEqual(added, [['501', 'x'], ['501', 'y']])
  const refused = await tools.get('add_test_steps').handler({ key: 'PROJ-2', steps: [{ step: 'x' }] })
  assert.match(text(refused), /PROJ-2 is a Bug, not a Zephyr test/)
})

// --- create_test_cycle -------------------------------------------------------

test('create_test_cycle resolves the version, converts dates and signs the description', async () => {
  let sent
  const tools = setup({
    listProjectVersions: async () => [{ id: '2001', name: 'Release 12' }],
    listTestCycles: async (_config, projectId, { versionId }) => {
      assert.equal(projectId, '10001')
      assert.equal(versionId, 2001)
      return { 400: { name: 'Smoke' }, recordsCount: 1 }
    },
    createTestCycle: async (_config, cycle) => { sent = cycle; return { id: '401' } },
  })
  const out = text(await tools.get('create_test_cycle').handler({
    project: 'PROJ', name: ' Regression ', version: 'release 12', environment: 'UAT',
    description: 'Full pass', start_date: '2026-12-01', end_date: '2026-12-05',
  }))
  assert.deepEqual(sent, {
    projectId: '10001', versionId: 2001, name: 'Regression', description: 'Full pass\n\n_(ai-generated · jira-tools)_',
    build: undefined, environment: 'UAT', startDate: '1/Dec/26', endDate: '5/Dec/26',
  })
  assert.match(out, /Created test cycle "Regression" \(id 401\) in PROJ \/ Release 12/)
})

test('create_test_cycle refuses a same-name cycle in the version unless allow_duplicate', async () => {
  let created = 0
  const tools = setup({
    listTestCycles: async () => ({ 70: { name: 'Release 12' }, recordsCount: 1 }),
    createTestCycle: async () => { created += 1; return { id: '402' } },
  })
  const refused = await tools.get('create_test_cycle').handler({ project: 'PROJ', name: 'release 12' })
  assert.match(text(refused), /already has a test cycle named "Release 12" \(id 70\)/)
  assert.equal(created, 0)
  await tools.get('create_test_cycle').handler({ project: 'PROJ', name: 'release 12', allow_duplicate: true })
  assert.equal(created, 1)
})

test('create_test_cycle rejects an end date before the start date', async () => {
  const tools = setup()
  const result = await tools.get('create_test_cycle').handler({ project: 'PROJ', name: 'X', start_date: '2026-12-05', end_date: '2026-12-01' })
  assert.match(text(result), /end_date must not be before start_date/)
})

// --- add_tests_to_cycle ------------------------------------------------------

/** Fake client for a cycle 70 holding PROJ-30 at the root. */
function cycleClient(extra = {}) {
  const issues = {
    'PROJ-30': { id: '501', fields: { issuetype: TEST_TYPE, project: { id: '10001' } } },
    'PROJ-31': { id: '502', fields: { issuetype: TEST_TYPE, project: { id: '10001' } } },
    'PROJ-32': { id: '503', fields: { issuetype: TEST_TYPE, project: { id: '10001' } } },
    'PROJ-5': { id: '5', fields: { issuetype: { name: 'Story' }, project: { id: '10001' } } },
  }
  return {
    getTestCycle: async () => ({ name: 'Release 12', projectId: 10001, versionId: -1 }),
    getIssue: async (_config, key) => {
      if (!issues[key]) throw Object.assign(new JiraError(`Not found: ${key} (404).`), { status: 404 })
      return issues[key]
    },
    searchExecutions: async () => ({ executions: [{ id: 77, issueKey: 'PROJ-30' }, { id: 78, issueKey: 'PROJ-31', folderId: 12 }], total: 2 }),
    listCycleFolders: async () => [{ folderId: 12, folderName: 'Login' }],
    ...extra,
  }
}

test('add_tests_to_cycle adds new tests and skips the ones already in the cycle root', async () => {
  const posted = []
  const tools = setup(cycleClient({
    createExecution: async (_config, execution) => { posted.push(execution); return { id: 900 + posted.length } },
  }))
  const out = text(await tools.get('add_tests_to_cycle').handler({ cycle_id: 70, keys: ['proj-30..32'] }))
  assert.deepEqual(posted, [
    { issueId: '502', cycleId: 70, projectId: 10001, versionId: -1, folderId: undefined },
    { issueId: '503', cycleId: 70, projectId: 10001, versionId: -1, folderId: undefined },
  ])
  assert.match(out, /Added 2\/2 tests to cycle "Release 12" \(id 70\):\n- PROJ-31 → execution #901\n- PROJ-32 → execution #902/)
  assert.match(out, /Already in the cycle \(skipped\): PROJ-30 \(#77\)/)
})

test('add_tests_to_cycle scopes the skip check to the folder', async () => {
  const posted = []
  const tools = setup(cycleClient({
    createExecution: async (_config, execution) => { posted.push(execution.issueId); return { id: 1 } },
  }))
  const out = text(await tools.get('add_tests_to_cycle').handler({ cycle_id: 70, keys: ['PROJ-30', 'PROJ-31'], folder_id: 12 }))
  assert.deepEqual(posted, ['501'])
  assert.match(out, /cycle "Release 12" \(id 70\) \/ folder "Login"/)
  const wrong = await tools.get('add_tests_to_cycle').handler({ cycle_id: 70, keys: ['PROJ-30'], folder_id: 1 })
  assert.match(text(wrong), /Folder 1 is not in cycle 70\. Folders: #12 Login/)
})

test('add_tests_to_cycle adds nothing when a key is unknown or not a test', async () => {
  let posted = false
  const tools = setup(cycleClient({ createExecution: async () => { posted = true; return { id: 1 } } }))
  const result = await tools.get('add_tests_to_cycle').handler({ cycle_id: 70, keys: ['PROJ-31', 'PROJ-5', 'PROJ-99'] })
  assert.equal(result.isError, true)
  assert.match(text(result), /Nothing added — not found: PROJ-99; not Zephyr tests: PROJ-5/)
  assert.equal(posted, false)
})

// --- set_execution_status ----------------------------------------------------

test('set_execution_status sets the matched status and signs the comment', async () => {
  const sent = []
  const tools = setup({
    updateExecutionStatus: async (_config, id, update) => {
      sent.push([id, update])
      return { issueKey: `PROJ-${id}`, cycleName: 'Release 12' }
    },
  })
  const out = text(await tools.get('set_execution_status').handler({ execution_ids: [30, 31, 30], status: 'fail', comment: 'Step 2: no error' }))
  assert.deepEqual(sent, [
    [30, { status: 2, comment: 'Step 2: no error\n\n_(ai-generated · jira-tools)_' }],
    [31, { status: 2, comment: 'Step 2: no error\n\n_(ai-generated · jira-tools)_' }],
  ])
  assert.match(out, /Set FAIL on 2\/2 executions:\n- #30 PROJ-30 · Release 12\n- #31 PROJ-31 · Release 12/)
})

test('set_execution_status without a comment leaves the comment out', async () => {
  let update
  const tools = setup({ updateExecutionStatus: async (_config, _id, u) => { update = u; return {} } })
  await tools.get('set_execution_status').handler({ execution_ids: [5], status: 'PASS' })
  assert.deepEqual(update, { status: 1, comment: undefined })
})

test('set_execution_status: unknown status lists the options; budget refuses before any write', async () => {
  let calls = 0
  const tools = setup({ updateExecutionStatus: async () => { calls += 1; return {} } }, { ...CONFIG, writeBudget: { creates: 10, total: 2 } })
  assert.match(text(await tools.get('set_execution_status').handler({ execution_ids: [1], status: 'done' })), /Available: PASS, FAIL/)
  consumeWriteBudget(CONFIG, 'write')
  const refused = await tools.get('set_execution_status').handler({ execution_ids: [1, 2], status: 'PASS' })
  assert.match(text(refused), /write limit would be exceeded/)
  assert.equal(calls, 0)
})
