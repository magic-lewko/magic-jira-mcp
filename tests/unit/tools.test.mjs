import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { registerTools } from '../../plugins/jira-tools/src/server.mjs'
import { readTools } from '../../plugins/jira-tools/src/tools/index.mjs'
import { JiraError } from '../../plugins/jira-tools/src/jira-client.mjs'

const fixture = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'issue-full.json'), 'utf8'),
)

const CONFIG = { server: 'https://jira.example.pl', token: 't', projects: {} }

/** Minimal server stub capturing registered tools. */
function stubServer() {
  const tools = new Map()
  return {
    tools,
    registerTool(name, config, handler) { tools.set(name, { config, handler }) },
  }
}

/** Register everything against a fake client and return the tool map. */
function setup({ client = {}, config = CONFIG, write = [] } = {}) {
  const server = stubServer()
  registerTools(server, { getConfig: () => config, client }, { write })
  return server.tools
}

const FAKE_WRITE_TOOL = {
  name: 'create_issue',
  config: { description: 'fake', inputSchema: {} },
  run: async () => 'created',
}

// --- registration & write gate ----------------------------------------------

test('all read tools are registered', () => {
  const tools = setup()
  const expected = [
    'search_issues', 'get_issue', 'list_boards', 'get_active_sprint', 'get_sprint_issues',
    'get_epic_status', 'get_issue_changelog', 'get_current_user', 'get_project_config',
    'get_version',
  ]
  assert.deepEqual([...tools.keys()].sort(), expected.sort())
  assert.equal(readTools.length, expected.length)
})

test('get_version answers even without config (health check)', async () => {
  const tools = setup({ config: null })
  const result = await tools.get('get_version').handler({})
  assert.notEqual(result.isError, true)
  assert.match(result.content[0].text, /jira-tools MCP server v\d+\.\d+\.\d+/)
  assert.match(result.content[0].text, /Config: NOT loaded/)
})

test('get_version reports the loaded config server', async () => {
  const tools = setup() // CONFIG points at https://jira.example.pl
  const result = await tools.get('get_version').handler({})
  assert.match(result.content[0].text, /Config: loaded — server https:\/\/jira\.example\.pl/)
  assert.match(result.content[0].text, /Write budget this session: \d+\/\d+ creates, \d+\/\d+ writes/)
})

test('write tools are always registered (no write-mode gate)', () => {
  assert.equal(setup({ write: [FAKE_WRITE_TOOL] }).has('create_issue'), true)
  // even with no config at all — the tools exist; the handler returns setup
  // instructions until configured, and the budget/dry-run guard the writes.
  assert.equal(setup({ config: null, write: [FAKE_WRITE_TOOL] }).has('create_issue'), true)
})

// --- unconfigured behaviour ---------------------------------------------------

test('without config every tool returns setup instructions, not an error', async () => {
  const tools = setup({ config: null })
  const result = await tools.get('search_issues').handler({ jql: 'x' })
  assert.notEqual(result.isError, true)
  assert.match(result.content[0].text, /\/jira-tools:jira-setup/)
})

// --- happy paths over a fake client ------------------------------------------

test('search_issues formats the page compactly', async () => {
  const tools = setup({
    client: { searchIssues: async () => ({ issues: [fixture], total: 1, startAt: 0 }) },
  })
  const result = await tools.get('search_issues').handler({ jql: 'project = PROJ' })
  assert.match(result.content[0].text, /PROJ-42 \[In Progress\] Bug\/High/)
})

test('search_issues extra fields: top-level id, full timestamps, flattened objects, unknown fields flagged', async () => {
  const issue = {
    id: '134157',
    key: 'PROJ-9',
    self: 'https://jira.example.pl/rest/api/2/issue/134157',
    fields: {
      summary: 'Report row',
      status: { name: 'Done' },
      issuetype: { name: 'Task' },
      priority: { name: 'Medium' },
      assignee: null,
      labels: [],
      updated: '2026-08-12T14:03:22.000+0200',
      created: '2026-08-01T09:15:00.000+0200',
      reporter: { name: 'jkowalski', displayName: 'Jan Kowalski', avatarUrls: { '48x48': 'https://x/a.png' } },
      resolution: { name: 'Done', id: '1' },
      components: [{ name: 'Web' }, { name: 'Backend' }],
    },
  }
  let asked = null
  const tools = setup({
    client: { searchIssues: async (_config, opts) => { asked = opts.fields; return { issues: [issue], total: 1, startAt: 0 } } },
  })
  const result = await tools.get('search_issues').handler({
    jql: 'project = PROJ',
    fields: ['id', 'created', 'updated', 'reporter', 'resolution', 'components', 'nosuchfield'],
  })
  const text = result.content[0].text
  assert.match(text, /PROJ-9 · id: 134157 · created: 2026-08-01 09:15 · updated: 2026-08-12 14:03 · reporter: jkowalski · resolution: Done · components: Web, Backend · nosuchfield: \?/)
  assert.match(text, /not returned by Jira: nosuchfield/)
  assert.ok(!text.includes('avatarUrls'), 'objects must be flattened, never raw JSON')
  assert.ok(asked.includes('reporter') && asked.includes('updated'), 'requested fields are fetched (updated included, even though it is a default field)')
  assert.ok(!asked.includes('id'), 'top-level id is not requested from Jira as a field')
})

test('get_issue expands ranges and reports per-key errors', async () => {
  const asked = []
  const tools = setup({
    client: {
      getIssue: async (_config, key) => {
        asked.push(key)
        if (key === 'PROJ-43') throw new JiraError('Not found: PROJ-43 (404).')
        return fixture
      },
    },
  })
  const result = await tools.get('get_issue').handler({ key: 'PROJ-42..43' })
  assert.deepEqual(asked, ['PROJ-42', 'PROJ-43'])
  assert.match(result.content[0].text, /PROJ-42 — \[123\] Login screen crashes/)
  assert.match(result.content[0].text, /! PROJ-43: Not found/)
})

test('get_issue without key/keys → readable error', async () => {
  const tools = setup()
  const result = await tools.get('get_issue').handler({})
  assert.equal(result.isError, true)
  assert.match(result.content[0].text, /Provide an issue key/)
})

test('get_sprint_issues resolves sprint by case-insensitive name', async () => {
  const tools = setup({
    client: {
      listSprints: async () => [{ id: 9, name: 'DC Sprint 1', state: 'active' }],
      getSprintIssues: async (_config, id) => {
        assert.equal(id, 9)
        return { issues: [fixture], total: 1 }
      },
    },
  })
  const result = await tools.get('get_sprint_issues').handler({ board_id: 1, sprint_name: 'dc sprint 1' })
  assert.match(result.content[0].text, /Sprint: DC Sprint 1/)
  assert.match(result.content[0].text, /PROJ-42/)
})

test('get_epic_status falls back to JQL when the Agile epic endpoint fails', async () => {
  let jqlUsed = null
  const tools = setup({
    client: {
      getEpicIssues: async () => { throw new JiraError('Not found: epic (404).', { status: 404 }) },
      searchIssues: async (_config, { jql }) => {
        jqlUsed = jql
        return { issues: [fixture], total: 1, startAt: 0 }
      },
    },
  })
  const result = await tools.get('get_epic_status').handler({ epic_key: 'proj-40' })
  assert.equal(jqlUsed, '"Epic Link" = PROJ-40')
  assert.match(result.content[0].text, /Epic PROJ-40/)
})

test('JiraError message is passed through as isError result', async () => {
  const tools = setup({
    client: { getMyself: async () => { throw new JiraError('The PAT token expired (401).') } },
  })
  const result = await tools.get('get_current_user').handler({})
  assert.equal(result.isError, true)
  assert.equal(result.content[0].text, 'The PAT token expired (401).')
})

test('get_project_config asks to pick a board when several exist', async () => {
  const tools = setup({
    client: {
      getProject: async () => ({ name: 'Proj', components: [], issueTypes: [] }),
      listBoards: async () => [{ id: 1, name: 'A', type: 'scrum' }, { id: 2, name: 'B', type: 'kanban' }],
      listFields: async () => [],
    },
  })
  const result = await tools.get('get_project_config').handler({ project: 'PROJ' })
  assert.match(result.content[0].text, /call again with board_id/)
  assert.match(result.content[0].text, /- 1: A \(scrum\)/)
})

test('get_project_config builds a full profile with epic link detection', async () => {
  const tools = setup({
    client: {
      getProject: async () => ({
        name: 'Proj',
        components: [{ name: 'iOS' }, { name: 'Web' }],
        issueTypes: [{ name: 'Story' }, { name: 'Bug' }],
      }),
      listBoards: async () => [{ id: 7, name: 'Proj board', type: 'scrum' }],
      listFields: async () => [{ id: 'customfield_10008', name: 'Epic Link', schema: { custom: 'x:gh-epic-link' } }],
      getBoardConfiguration: async () => ({
        columnConfig: { columns: [
          { name: 'To Do', statuses: [{ id: '1' }] },
          { name: 'Done', statuses: [{ id: '2' }] },
        ] },
      }),
      listStatuses: async () => [{ id: '1', name: 'To Do' }, { id: '2', name: 'Done' }],
    },
  })
  const result = await tools.get('get_project_config').handler({ project: 'proj' })
  const text = result.content[0].text
  assert.match(text, /Board: Proj board \(id 7\)/)
  assert.match(text, /Statuses \(column order\): To Do → Done/)
  assert.match(text, /"epicLinkField": "customfield_10008"/)
  assert.match(text, /"iOS"/)
})
