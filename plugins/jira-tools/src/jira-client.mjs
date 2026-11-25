/**
 * @fileoverview HTTP layer for the Jira MCP server: auth, timeout, error
 * mapping, pagination and issue-key range expansion — all in one place.
 *
 * Every request goes through {@link jiraFetch}. Error messages are end-user
 * facing (English) and NEVER contain the token. Debug output goes exclusively
 * to stderr and only when JIRA_DEBUG=1 — stdout belongs to the MCP protocol.
 */

/** Default field set for compact issue lists (SPEC §4.1). */
export const LIST_FIELDS = ['summary', 'status', 'issuetype', 'priority', 'assignee', 'labels', 'updated']

/** Full field set for single-issue detail (SPEC §4.1, get_issue). */
export const DETAIL_FIELDS = [
  'summary', 'status', 'issuetype', 'priority', 'assignee', 'reporter',
  'created', 'updated', 'labels', 'components', 'description', 'comment',
  'attachment', 'parent', 'fixVersions',
]

/** Error carrying a ready-to-show, token-free message. */
export class JiraError extends Error {
  /**
   * @param {string} message - end-user facing message
   * @param {{status?: number}} [meta]
   */
  constructor(message, { status } = {}) {
    super(message)
    this.name = 'JiraError'
    this.status = status
  }
}

/**
 * Write a debug line to stderr, only when JIRA_DEBUG=1.
 * Never pass secrets in — and never use stdout here.
 *
 * @param {...unknown} args
 */
export function debug(...args) {
  if (process.env.JIRA_DEBUG === '1') console.error('[jira-mcp]', ...args)
}

/**
 * Expand issue-key inputs into a flat list. Accepts bare keys plus inclusive
 * ranges: "PROJ-98..111" and "PROJ-98..PROJ-111". Order preserved, duplicates removed.
 *
 * @param {string[]} inputs
 * @returns {string[]}
 */
export function expandKeys(inputs) {
  const out = []
  for (const raw of inputs) {
    const arg = String(raw).trim().toUpperCase()
    if (!arg) continue
    const range = /^([A-Z][A-Z0-9]*)-(\d+)\.\.(?:[A-Z][A-Z0-9]*-)?(\d+)$/.exec(arg)
    if (range) {
      const [, proj, from, to] = range
      const lo = Number(from)
      const hi = Number(to)
      for (let n = lo; n <= hi; n++) out.push(`${proj}-${n}`)
    } else {
      out.push(arg)
    }
  }
  return [...new Set(out)]
}

/**
 * Map a non-OK HTTP response to a JiraError with an end-user message
 * (SPEC §4.3). The token never appears in messages.
 *
 * @param {number} status
 * @param {string} bodyText
 * @param {string} what - short description of the requested resource
 * @returns {JiraError}
 */
function mapHttpError(status, bodyText, what) {
  if (status === 401) {
    return new JiraError(
      'The PAT token expired or is invalid (401). Ask the user for a fresh Personal Access Token '
      + '(Jira → avatar → Personal Access Tokens → Create token), then save it: in Claude Code run '
      + '/jira-tools:jira-setup --update to write it to ~/.config/jira-tools/config.json; in Claude '
      + 'Desktop the config file cannot be written from here — tell the user to paste the new token '
      + 'into the jira-tools extension or plugin settings (token field).',
      { status },
    )
  }
  if (status === 404) {
    return new JiraError(`Not found: ${what} (404).`, { status })
  }
  return new JiraError(`Jira returned error ${status} for ${what}: ${bodyText.slice(0, 300)}`, { status })
}

/**
 * Single entry point for all Jira HTTP calls: Bearer auth, JSON headers,
 * 30 s timeout, unified error mapping.
 *
 * @param {{server: string, token: string}} config
 * @param {string} path - path starting with /rest/...
 * @param {{method?: string, body?: object, what?: string, timeoutMs?: number}} [opts]
 * @returns {Promise<any>} parsed JSON (or null for 204)
 */
export async function jiraFetch(config, path, { method = 'GET', body, form, what = path, timeoutMs = 30_000 } = {}) {
  const url = `${config.server}${path}`
  const headers = {
    Authorization: `Bearer ${config.token}`,
    Accept: 'application/json',
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  // Multipart uploads: fetch sets Content-Type (with boundary) itself; Jira
  // additionally requires the XSRF opt-out header.
  if (form !== undefined) headers['X-Atlassian-Token'] = 'no-check'

  debug(method, path)
  let res
  try {
    res = await fetch(url, {
      method,
      headers,
      body: form ?? (body === undefined ? undefined : JSON.stringify(body)),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw new JiraError(
        `Request timed out (${Math.round(timeoutMs / 1000)} s) for ${what}. `
        + 'Check the Jira server URL and the connection (VPN?).',
      )
    }
    throw new JiraError(`Could not connect to ${config.server}: ${err?.message ?? err}`)
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw mapHttpError(res.status, text, what)
  }
  // Some write endpoints answer 201/204 with an empty body — tolerate it.
  const text = await res.text()
  return text ? JSON.parse(text) : null
}

/**
 * Build a query string from defined params only.
 *
 * @param {Record<string, string|number|undefined>} params
 * @returns {string} leading "?" included, or "" when empty
 */
function query(params) {
  const q = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') q.set(k, String(v))
  }
  const s = q.toString()
  return s ? `?${s}` : ''
}

/**
 * One page of JQL search results.
 *
 * @param {object} config
 * @param {{jql: string, maxResults?: number, fields?: string[], startAt?: number}} params
 * @returns {Promise<{issues: object[], total: number, startAt: number}>}
 */
export async function searchIssues(config, { jql, maxResults = 30, fields = LIST_FIELDS, startAt = 0 }) {
  const capped = Math.min(Math.max(1, maxResults), 100)
  const path = `/rest/api/2/search${query({ jql, fields: fields.join(','), startAt, maxResults: capped })}`
  const page = await jiraFetch(config, path, { what: `JQL results "${jql}"` })
  return { issues: page.issues ?? [], total: page.total ?? 0, startAt: page.startAt ?? startAt }
}

/**
 * Collect ALL pages of a search-like endpoint returning {issues, total}.
 * Hard-capped to avoid runaway context usage.
 *
 * @param {object} config
 * @param {(startAt: number) => string} pathFor
 * @param {{what: string, limit?: number}} opts
 * @returns {Promise<{issues: object[], total: number}>}
 */
async function fetchAllIssuePages(config, pathFor, { what, limit = 300 }) {
  const issues = []
  let total = Infinity
  while (issues.length < Math.min(total, limit)) {
    const page = await jiraFetch(config, pathFor(issues.length), { what })
    total = page.total ?? 0
    const batch = page.issues ?? []
    if (batch.length === 0) break
    issues.push(...batch)
  }
  return { issues: issues.slice(0, limit), total }
}

/**
 * Collect ALL pages of an Agile endpoint returning {values, isLast}.
 *
 * @param {object} config
 * @param {(startAt: number) => string} pathFor
 * @param {{what: string, limit?: number}} opts
 * @returns {Promise<object[]>}
 */
async function fetchAllValuePages(config, pathFor, { what, limit = 200 }) {
  const values = []
  let isLast = false
  while (!isLast && values.length < limit) {
    const page = await jiraFetch(config, pathFor(values.length), { what })
    values.push(...(page.values ?? []))
    isLast = page.isLast === true || (page.values ?? []).length === 0
  }
  return values.slice(0, limit)
}

/**
 * Single issue with chosen fields (and optional expand, e.g. "changelog").
 *
 * @param {object} config
 * @param {string} key
 * @param {{fields?: string[], expand?: string}} [opts]
 * @returns {Promise<object>}
 */
export function getIssue(config, key, { fields = DETAIL_FIELDS, expand } = {}) {
  const path = `/rest/api/2/issue/${encodeURIComponent(key)}${query({ fields: fields.join(','), expand })}`
  return jiraFetch(config, path, { what: key })
}

/**
 * Authenticated user (setup verification).
 *
 * @param {object} config
 * @returns {Promise<{displayName?: string, name?: string, emailAddress?: string}>}
 */
export function getMyself(config) {
  return jiraFetch(config, '/rest/api/2/myself', { what: 'current user (myself)' })
}

/**
 * Agile boards, optionally filtered by project key.
 *
 * @param {object} config
 * @param {{project?: string}} [opts]
 * @returns {Promise<object[]>}
 */
export function listBoards(config, { project } = {}) {
  return fetchAllValuePages(
    config,
    (startAt) => `/rest/agile/1.0/board${query({ projectKeyOrId: project, startAt, maxResults: 50 })}`,
    { what: project ? `boards of project ${project}` : 'board list' },
  )
}

/**
 * Sprints of a board (optionally by state: active/future/closed).
 *
 * @param {object} config
 * @param {number} boardId
 * @param {{state?: string}} [opts]
 * @returns {Promise<object[]>}
 */
export function listSprints(config, boardId, { state } = {}) {
  return fetchAllValuePages(
    config,
    (startAt) => `/rest/agile/1.0/board/${boardId}/sprint${query({ state, startAt, maxResults: 50 })}`,
    { what: `sprints of board ${boardId}` },
  )
}

/**
 * The active sprint of a board, or null when none.
 *
 * @param {object} config
 * @param {number} boardId
 * @returns {Promise<object|null>}
 */
export async function getActiveSprint(config, boardId) {
  const sprints = await listSprints(config, boardId, { state: 'active' })
  return sprints[0] ?? null
}

/**
 * All issues of a sprint (compact fields), capped at 300.
 *
 * @param {object} config
 * @param {number} sprintId
 * @param {{fields?: string[]}} [opts]
 * @returns {Promise<{issues: object[], total: number}>}
 */
export function getSprintIssues(config, sprintId, { fields = LIST_FIELDS } = {}) {
  return fetchAllIssuePages(
    config,
    (startAt) => `/rest/agile/1.0/sprint/${sprintId}/issue${query({ fields: fields.join(','), startAt, maxResults: 100 })}`,
    { what: `issues of sprint ${sprintId}` },
  )
}

/**
 * All child issues of an epic (Agile API — no custom field needed), capped at 300.
 *
 * @param {object} config
 * @param {string} epicKey
 * @param {{fields?: string[]}} [opts]
 * @returns {Promise<{issues: object[], total: number}>}
 */
export function getEpicIssues(config, epicKey, { fields = LIST_FIELDS } = {}) {
  return fetchAllIssuePages(
    config,
    (startAt) => `/rest/agile/1.0/epic/${encodeURIComponent(epicKey)}/issue${query({ fields: fields.join(','), startAt, maxResults: 100 })}`,
    { what: `issues of epic ${epicKey}` },
  )
}

/**
 * All Jira fields (used to auto-detect the Epic Link custom field).
 *
 * @param {object} config
 * @returns {Promise<object[]>}
 */
export function listFields(config) {
  return jiraFetch(config, '/rest/api/2/field', { what: 'field list' })
}

/**
 * All statuses (id → name mapping for board configuration columns).
 *
 * @param {object} config
 * @returns {Promise<object[]>}
 */
export function listStatuses(config) {
  return jiraFetch(config, '/rest/api/2/status', { what: 'status list' })
}

/**
 * Project detail: components, issue types, name.
 *
 * @param {object} config
 * @param {string} projectKey
 * @returns {Promise<object>}
 */
export function getProject(config, projectKey) {
  return jiraFetch(config, `/rest/api/2/project/${encodeURIComponent(projectKey)}`, { what: `project ${projectKey}` })
}

/**
 * Board configuration (columns → status ids).
 *
 * @param {object} config
 * @param {number} boardId
 * @returns {Promise<object>}
 */
export function getBoardConfiguration(config, boardId) {
  return jiraFetch(config, `/rest/agile/1.0/board/${boardId}/configuration`, { what: `board configuration for ${boardId}` })
}

/**
 * Path of one project property (Jira entity property: a JSON value stored on
 * the project, readable by everyone with Browse Projects).
 *
 * @param {string} projectKey
 * @param {string} propertyKey
 * @returns {string}
 */
function projectPropertyPath(projectKey, propertyKey) {
  return `/rest/api/2/project/${encodeURIComponent(projectKey)}/properties/${encodeURIComponent(propertyKey)}`
}

/**
 * Value of one project property, or null when the property is not set.
 *
 * @param {object} config
 * @param {string} projectKey
 * @param {string} propertyKey
 * @returns {Promise<any|null>}
 */
export async function getProjectProperty(config, projectKey, propertyKey) {
  try {
    const res = await jiraFetch(config, projectPropertyPath(projectKey, propertyKey), {
      what: `property "${propertyKey}" of project ${projectKey}`,
    })
    return res?.value ?? null
  } catch (err) {
    if (err instanceof JiraError && err.status === 404) return null
    throw err
  }
}

/**
 * Active users matching a text (Jira Server matches the username, the
 * display name and the e-mail).
 *
 * @param {object} config
 * @param {string} text
 * @returns {Promise<{name: string, displayName: string}[]>}
 */
export function findUsers(config, text) {
  return jiraFetch(config, `/rest/api/2/user/search${query({ username: text, maxResults: 20 })}`, {
    what: `user search "${text}"`,
  })
}

// --- write operations (Phase 2, registered only behind JIRA_ALLOW_WRITE) ----

/**
 * Create ONE issue.
 *
 * @param {object} config
 * @param {object} fields - Jira issue fields payload
 * @returns {Promise<{key: string}>}
 */
export function createIssue(config, fields) {
  return jiraFetch(config, '/rest/api/2/issue', {
    method: 'POST', body: { fields }, what: 'create issue',
  })
}

/**
 * Create several issues in ONE request (Jira Server default limit: 50).
 * Jira answers 201 with the created issues plus per-item `errors`
 * (`failedElementNumber` = index in the input); an all-failed batch is a 400
 * and surfaces as a JiraError.
 *
 * @param {object} config
 * @param {object[]} fieldsList - one Jira fields payload per issue, in order
 * @returns {Promise<{issues: {key: string}[], errors: object[]}>}
 */
export function createIssuesBulk(config, fieldsList) {
  return jiraFetch(config, '/rest/api/2/issue/bulk', {
    method: 'POST',
    body: { issueUpdates: fieldsList.map((fields) => ({ fields })) },
    what: 'create issues (bulk)',
  })
}

/**
 * Update fields of an existing issue (Jira answers 204).
 *
 * @param {object} config
 * @param {string} key
 * @param {object} fields - partial Jira fields payload
 * @returns {Promise<null>}
 */
export function updateIssue(config, key, fields) {
  return jiraFetch(config, `/rest/api/2/issue/${encodeURIComponent(key)}`, {
    method: 'PUT', body: { fields }, what: `update ${key}`,
  })
}

/**
 * Add a comment to an issue.
 *
 * @param {object} config
 * @param {string} key
 * @param {string} body - comment text
 * @returns {Promise<object>}
 */
export function addComment(config, key, body) {
  return jiraFetch(config, `/rest/api/2/issue/${encodeURIComponent(key)}/comment`, {
    method: 'POST', body: { body }, what: `comment on ${key}`,
  })
}

/**
 * Available workflow transitions of an issue.
 *
 * @param {object} config
 * @param {string} key
 * @returns {Promise<{transitions: object[]}>}
 */
export function listTransitions(config, key) {
  return jiraFetch(config, `/rest/api/2/issue/${encodeURIComponent(key)}/transitions`, {
    what: `transitions of ${key}`,
  })
}

/**
 * Execute a workflow transition (Jira answers 204).
 *
 * @param {object} config
 * @param {string} key
 * @param {string} transitionId
 * @returns {Promise<null>}
 */
export function doTransition(config, key, transitionId) {
  return jiraFetch(config, `/rest/api/2/issue/${encodeURIComponent(key)}/transitions`, {
    method: 'POST', body: { transition: { id: String(transitionId) } }, what: `transition of ${key}`,
  })
}

/**
 * Upload ONE file as an issue attachment (multipart; Jira requires the
 * X-Atlassian-Token header, added by jiraFetch for form uploads).
 *
 * @param {object} config
 * @param {string} key - issue key
 * @param {{filename: string, bytes: Uint8Array}} file
 * @returns {Promise<object[]>} created attachment entries
 */
export function addAttachment(config, key, { filename, bytes }) {
  const form = new FormData()
  form.append('file', new Blob([bytes]), filename)
  return jiraFetch(config, `/rest/api/2/issue/${encodeURIComponent(key)}/attachments`, {
    method: 'POST', form, what: `attachment on ${key}`, timeoutMs: 60_000,
  })
}

/**
 * Available issue link types (names vary per instance: Relates, Blocks, …).
 *
 * @param {object} config
 * @returns {Promise<{issueLinkTypes: object[]}>}
 */
export function listIssueLinkTypes(config) {
  return jiraFetch(config, '/rest/api/2/issueLinkType', { what: 'link types' })
}

/**
 * Link two issues (Jira answers 201, empty body). `from` is the source of the
 * link: for "Blocks", from blocks to.
 *
 * Jira's field names are the opposite of what they suggest: in the POST body
 * `inwardIssue` is the SOURCE (the one that "blocks") and `outwardIssue` the
 * destination (the one that "is blocked by"). Verified on Jira Server 8.21.0
 * (2026-09-24): posting {outwardIssue: A, inwardIssue: B, type: Blocks} made
 * B block A. Versions <= 0.6.0 sent `from` as `outwardIssue` and therefore
 * recorded every directional link the wrong way round.
 *
 * @param {object} config
 * @param {{type: string, from: string, to: string}} link
 * @returns {Promise<null>}
 */
export function linkIssues(config, { type, from, to }) {
  return jiraFetch(config, '/rest/api/2/issueLink', {
    method: 'POST',
    body: { type: { name: type }, inwardIssue: { key: from }, outwardIssue: { key: to } },
    what: `link ${from} → ${to}`,
  })
}

/**
 * Move issues into an epic (Agile API, Jira answers 204; max 50 keys per call).
 *
 * @param {object} config
 * @param {string} epicKey
 * @param {string[]} issueKeys
 * @returns {Promise<null>}
 */
export function addIssuesToEpic(config, epicKey, issueKeys) {
  return jiraFetch(config, `/rest/agile/1.0/epic/${encodeURIComponent(epicKey)}/issue`, {
    method: 'POST', body: { issues: issueKeys }, what: `assign issues to epic ${epicKey}`,
  })
}

/**
 * One Agile board: id, name, type ("scrum" or "kanban").
 *
 * @param {object} config
 * @param {number} boardId
 * @returns {Promise<{id: number, name: string, type: string}>}
 */
export function getBoard(config, boardId) {
  return jiraFetch(config, `/rest/agile/1.0/board/${boardId}`, { what: `board ${boardId}` })
}

/**
 * Create a future sprint on a Scrum board (Agile API, Jira answers 201 with
 * the sprint: id, name, state "future"). Goal and dates are optional; dates
 * are ISO 8601 date-time strings. Only the given fields are sent.
 *
 * @param {object} config
 * @param {{boardId: number, name: string, goal?: string, startDate?: string, endDate?: string}} sprint
 * @returns {Promise<{id: number, name: string, state: string}>}
 */
export function createSprint(config, { boardId, name, goal, startDate, endDate }) {
  const body = { name, originBoardId: boardId }
  if (goal) body.goal = goal
  if (startDate) body.startDate = startDate
  if (endDate) body.endDate = endDate
  return jiraFetch(config, '/rest/agile/1.0/sprint', { method: 'POST', body, what: `create sprint "${name}"` })
}

/**
 * Create or replace one project property (Jira answers 200 or 201 with an
 * empty body). Needs the Administer Projects permission.
 *
 * @param {object} config
 * @param {string} projectKey
 * @param {string} propertyKey
 * @param {object} value - JSON value
 * @returns {Promise<null>}
 */
export function setProjectProperty(config, projectKey, propertyKey, value) {
  return jiraFetch(config, projectPropertyPath(projectKey, propertyKey), {
    method: 'PUT', body: value, what: `property "${propertyKey}" of project ${projectKey}`,
  })
}

// --- Zephyr Squad Server (ZAPI) ----------------------------------------------

/** Zephyr Squad Server REST base; same host, same Bearer PAT as Jira. */
const ZAPI = '/rest/zapi/latest'

/**
 * jiraFetch for ZAPI paths. Zephyr sometimes reports a failure with HTTP 200
 * and an `errorDesc`/`errorId: "ERROR"` or `error` body — surface it as a JiraError.
 *
 * @param {object} config
 * @param {string} path - path below /rest/zapi/latest, starting with "/"
 * @param {{method?: string, body?: object, what?: string}} [opts]
 * @returns {Promise<any>}
 */
async function zapiFetch(config, path, opts = {}) {
  const res = await jiraFetch(config, `${ZAPI}${path}`, opts)
  if (res && typeof res === 'object' && !Array.isArray(res)) {
    const message = res.errorId === 'ERROR' ? res.errorDesc : (typeof res.error === 'string' ? res.error : undefined)
    if (message) throw new JiraError(`Zephyr refused ${opts.what ?? path}: ${String(message).slice(0, 300)}`)
  }
  return res
}

/**
 * Versions of a project (Zephyr cycles live per version; -1 = Unscheduled).
 *
 * @param {object} config
 * @param {string} projectKey
 * @returns {Promise<{id: string, name: string, released?: boolean, archived?: boolean}[]>}
 */
export function listProjectVersions(config, projectKey) {
  return jiraFetch(config, `/rest/api/2/project/${encodeURIComponent(projectKey)}/versions`, {
    what: `versions of project ${projectKey}`,
  })
}

/**
 * Test execution statuses of the instance (PASS, FAIL, WIP, BLOCKED, UNEXECUTED, custom ones).
 *
 * @param {object} config
 * @returns {Promise<{id: number, name: string}[]>}
 */
export function listExecutionStatuses(config) {
  return zapiFetch(config, '/util/testExecutionStatus', { what: 'Zephyr execution statuses (is Zephyr Squad installed?)' })
}

/**
 * Test cycles of a project. With a versionId Zephyr answers a flat map
 * `{cycleId: cycle, recordsCount}`; without one, a map `{versionId: [{cycleId: cycle}]}`.
 * Use cyclesFromResponse() to flatten either shape. Without
 * expand=executionSummaries Zephyr leaves the totals at 0.
 *
 * @param {object} config
 * @param {number|string} projectId
 * @param {{versionId?: number|string}} [opts]
 * @returns {Promise<object>}
 */
export function listTestCycles(config, projectId, { versionId } = {}) {
  return zapiFetch(config, `/cycle${query({ projectId, versionId, expand: 'executionSummaries' })}`, {
    what: `Zephyr test cycles of project ${projectId} (is Zephyr Squad installed?)`,
  })
}

/**
 * One test cycle: name, projectId, versionId, environment, build, dates.
 *
 * @param {object} config
 * @param {number} cycleId
 * @returns {Promise<object>}
 */
export function getTestCycle(config, cycleId) {
  return zapiFetch(config, `/cycle/${cycleId}`, { what: `Zephyr test cycle ${cycleId}` })
}

/**
 * Folders of a test cycle with their execution totals.
 *
 * @param {object} config
 * @param {number} cycleId
 * @param {{projectId: number|string, versionId: number|string}} scope
 * @returns {Promise<object[]>}
 */
export async function listCycleFolders(config, cycleId, { projectId, versionId }) {
  const path = `/cycle/${cycleId}/folders${query({ projectId, versionId, limit: 200, offset: 0 })}`
  const folders = await zapiFetch(config, path, { what: `folders of Zephyr cycle ${cycleId}` })
  return Array.isArray(folders) ? folders : []
}

/**
 * Executions matching a ZQL query, paged by absolute offset, capped at `limit`.
 *
 * @param {object} config
 * @param {{zql: string, limit?: number}} params
 * @returns {Promise<{executions: object[], total: number}>}
 */
export async function searchExecutions(config, { zql, limit = 50 }) {
  const executions = []
  let total = Infinity
  while (executions.length < Math.min(total, limit)) {
    const maxRecords = Math.min(100, limit - executions.length)
    const path = `/zql/executeSearch${query({ zqlQuery: zql, offset: executions.length, maxRecords })}`
    const page = await zapiFetch(config, path, { what: `ZQL "${zql}"` })
    total = page.totalCount ?? 0
    const batch = page.executions ?? []
    if (batch.length === 0) break
    executions.push(...batch)
  }
  return { executions: executions.slice(0, limit), total: Number.isFinite(total) ? total : executions.length }
}

/**
 * Steps of a Zephyr test (by Jira issue id, not key).
 *
 * @param {object} config
 * @param {number|string} issueId
 * @returns {Promise<{id: number, orderId: number, step: string, data: string, result: string}[]>}
 */
export async function getTestSteps(config, issueId) {
  const res = await zapiFetch(config, `/teststep/${issueId}`, { what: `test steps of issue ${issueId}` })
  if (Array.isArray(res)) return res
  return res?.stepBeanCollection ?? []
}

/**
 * Append ONE step to a Zephyr test.
 *
 * @param {object} config
 * @param {number|string} issueId
 * @param {{step: string, data?: string, result?: string}} step
 * @returns {Promise<object>}
 */
export function addTestStep(config, issueId, { step, data = '', result = '' }) {
  return zapiFetch(config, `/teststep/${issueId}`, {
    method: 'POST', body: { step, data, result }, what: `add test step to issue ${issueId}`,
  })
}

/**
 * Create ONE test cycle. Dates use Jira's date-picker format (d/MMM/yy).
 *
 * @param {object} config
 * @param {{projectId: number|string, versionId: number|string, name: string, description?: string, build?: string, environment?: string, startDate?: string, endDate?: string}} cycle
 * @returns {Promise<{id: string, responseMessage?: string}>}
 */
export function createTestCycle(config, { projectId, versionId, name, description, build, environment, startDate, endDate }) {
  const body = { name, projectId: String(projectId), versionId: String(versionId) }
  if (description) body.description = description
  if (build) body.build = build
  if (environment) body.environment = environment
  if (startDate) body.startDate = startDate
  if (endDate) body.endDate = endDate
  return zapiFetch(config, '/cycle', { method: 'POST', body, what: `create test cycle "${name}"` })
}

/**
 * Add ONE test to a cycle (optionally into a folder) as a new execution.
 * Zephyr answers a map keyed by the new execution id; the execution is returned.
 *
 * @param {object} config
 * @param {{issueId: number|string, cycleId: number, projectId: number|string, versionId: number|string, folderId?: number}} execution
 * @returns {Promise<object|null>}
 */
export async function createExecution(config, { issueId, cycleId, projectId, versionId, folderId }) {
  const body = {
    issueId: String(issueId), cycleId: String(cycleId), projectId: String(projectId), versionId: String(versionId),
  }
  if (folderId !== undefined) body.folderId = String(folderId)
  const res = await zapiFetch(config, '/execution', {
    method: 'POST', body, what: `add issue ${issueId} to test cycle ${cycleId}`,
  })
  if (res && typeof res === 'object' && res.id === undefined) {
    const [first] = Object.values(res)
    return first ?? null
  }
  return res
}

/**
 * Set the status (and optionally the comment) of ONE execution.
 *
 * @param {object} config
 * @param {number} executionId
 * @param {{status: number|string, comment?: string}} update
 * @returns {Promise<object>}
 */
export function updateExecutionStatus(config, executionId, { status, comment }) {
  const body = { status: Number(status) }
  if (comment !== undefined) body.comment = comment
  return zapiFetch(config, `/execution/${executionId}/execute`, {
    method: 'PUT', body, what: `status of execution ${executionId}`,
  })
}
