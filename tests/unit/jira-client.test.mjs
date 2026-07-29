import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'

import {
  expandKeys, jiraFetch, searchIssues, getSprintIssues, listBoards, JiraError,
} from '../../plugins/jira-tools/src/jira-client.mjs'

const CONFIG = { server: 'https://jira.example.pl', token: 'secret-token' }

const realFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = realFetch })

/** Install a fetch mock returning queued responses; records requests. */
function mockFetch(responses) {
  const calls = []
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init })
    const next = responses.shift()
    if (!next) throw new Error('mockFetch: no response queued')
    if (next instanceof Error) throw next
    return {
      ok: next.status < 400,
      status: next.status,
      json: async () => next.body,
      text: async () => (typeof next.body === 'string' ? next.body : JSON.stringify(next.body)),
    }
  }
  return calls
}

// --- expandKeys -------------------------------------------------------------

test('expandKeys: full and short ranges, singles, mixed, dedup', () => {
  assert.deepEqual(expandKeys(['PROJ-98..PROJ-101']), ['PROJ-98', 'PROJ-99', 'PROJ-100', 'PROJ-101'])
  assert.deepEqual(expandKeys(['PROJ-98..101']), ['PROJ-98', 'PROJ-99', 'PROJ-100', 'PROJ-101'])
  assert.deepEqual(expandKeys(['PROJ-1']), ['PROJ-1'])
  assert.deepEqual(expandKeys(['PROJ-1', 'PROJ-3..4', 'proj-1']), ['PROJ-1', 'PROJ-3', 'PROJ-4'])
  assert.deepEqual(expandKeys(['ABC2-7..8']), ['ABC2-7', 'ABC2-8'])
  assert.deepEqual(expandKeys([]), [])
})

// --- jiraFetch error mapping ------------------------------------------------

test('401 → PAT renewal instruction, without the token', async () => {
  mockFetch([{ status: 401, body: 'Unauthorized' }])
  await assert.rejects(
    () => jiraFetch(CONFIG, '/rest/api/2/myself', { what: 'test' }),
    (err) => {
      assert.ok(err instanceof JiraError)
      assert.match(err.message, /Personal Access Tokens/)
      assert.ok(!err.message.includes(CONFIG.token))
      return true
    },
  )
})

test('404 → "Not found" with resource name', async () => {
  mockFetch([{ status: 404, body: '' }])
  await assert.rejects(
    () => jiraFetch(CONFIG, '/rest/api/2/issue/PROJ-999', { what: 'PROJ-999' }),
    /Not found: PROJ-999 \(404\)/,
  )
})

test('500 → status + first 300 chars of body only', async () => {
  mockFetch([{ status: 500, body: 'X'.repeat(1000) }])
  await assert.rejects(
    () => jiraFetch(CONFIG, '/rest/api/2/search', { what: 'search' }),
    (err) => {
      assert.match(err.message, /error 500/)
      assert.ok(err.message.length < 400)
      return true
    },
  )
})

test('timeout → readable message, no token', async () => {
  const timeoutErr = new Error('The operation was aborted due to timeout')
  timeoutErr.name = 'TimeoutError'
  mockFetch([timeoutErr])
  await assert.rejects(
    () => jiraFetch(CONFIG, '/rest/api/2/search', { what: 'search' }),
    (err) => {
      assert.match(err.message, /timed out/)
      assert.ok(!err.message.includes(CONFIG.token))
      return true
    },
  )
})

test('network error → connection message, no token', async () => {
  mockFetch([Object.assign(new Error('getaddrinfo ENOTFOUND'), { name: 'TypeError' })])
  await assert.rejects(
    () => jiraFetch(CONFIG, '/rest/api/2/search'),
    (err) => {
      assert.match(err.message, /Could not connect/)
      assert.ok(!err.message.includes(CONFIG.token))
      return true
    },
  )
})

test('sends Bearer auth header and JSON accept', async () => {
  const calls = mockFetch([{ status: 200, body: {} }])
  await jiraFetch(CONFIG, '/rest/api/2/myself')
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${CONFIG.token}`)
  assert.equal(calls[0].init.headers.Accept, 'application/json')
})

// --- searchIssues -----------------------------------------------------------

test('searchIssues: builds query, caps maxResults at 100, returns page meta', async () => {
  const calls = mockFetch([{ status: 200, body: { issues: [{ key: 'PROJ-1' }], total: 250, startAt: 0 } }])
  const result = await searchIssues(CONFIG, { jql: 'project = PROJ', maxResults: 500 })
  const url = new URL(calls[0].url)
  assert.equal(url.searchParams.get('jql'), 'project = PROJ')
  assert.equal(url.searchParams.get('maxResults'), '100')
  assert.equal(result.total, 250)
  assert.deepEqual(result.issues.map((i) => i.key), ['PROJ-1'])
})

// --- pagination -------------------------------------------------------------

test('getSprintIssues: collects all pages of {issues,total}', async () => {
  const page = (keys, total) => ({ status: 200, body: { issues: keys.map((k) => ({ key: k })), total } })
  mockFetch([page(['A-1', 'A-2'], 3), page(['A-3'], 3)])
  const { issues, total } = await getSprintIssues(CONFIG, 42)
  assert.equal(total, 3)
  assert.deepEqual(issues.map((i) => i.key), ['A-1', 'A-2', 'A-3'])
})

test('listBoards: collects {values,isLast} pages and passes project filter', async () => {
  const calls = mockFetch([
    { status: 200, body: { values: [{ id: 1 }], isLast: false } },
    { status: 200, body: { values: [{ id: 2 }], isLast: true } },
  ])
  const boards = await listBoards(CONFIG, { project: 'PROJ' })
  assert.deepEqual(boards.map((b) => b.id), [1, 2])
  assert.equal(new URL(calls[0].url).searchParams.get('projectKeyOrId'), 'PROJ')
})
