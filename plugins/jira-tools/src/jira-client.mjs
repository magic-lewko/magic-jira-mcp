/**
 * @fileoverview HTTP layer for the Jira MCP server: auth, timeout, error
 * mapping, pagination and issue-key range expansion — all in one place.
 *
 * Every request goes through {@link jiraFetch}. Error messages are end-user
 * facing (Polish, per SPEC §4.3) and NEVER contain the token. Debug output
 * goes exclusively to stderr and only when JIRA_DEBUG=1 — stdout belongs to
 * the MCP protocol.
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
 * ranges: "PROJ-98..111" and "PROJ-98..PROJ-111" (pattern proven in
 * references/jira_show.mjs). Order preserved, duplicates removed.
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
      'Token PAT wygasł lub jest nieprawidłowy (401). Wygeneruj nowy: Jira → awatar profilu → '
      + 'Personal Access Tokens → Create token, a potem uruchom /jira-tools:jira-setup.',
      { status },
    )
  }
  if (status === 404) {
    return new JiraError(`Nie znaleziono: ${what} (404).`, { status })
  }
  return new JiraError(`Jira zwróciła błąd ${status} dla ${what}: ${bodyText.slice(0, 300)}`, { status })
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
export async function jiraFetch(config, path, { method = 'GET', body, what = path, timeoutMs = 30_000 } = {}) {
  const url = `${config.server}${path}`
  const headers = {
    Authorization: `Bearer ${config.token}`,
    Accept: 'application/json',
  }
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  debug(method, path)
  let res
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw new JiraError(
        `Przekroczono limit czasu żądania (${Math.round(timeoutMs / 1000)} s) dla ${what}. `
        + 'Sprawdź adres serwera Jira oraz połączenie (VPN?).',
      )
    }
    throw new JiraError(`Nie udało się połączyć z ${config.server}: ${err?.message ?? err}`)
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw mapHttpError(res.status, text, what)
  }
  if (res.status === 204) return null
  return res.json()
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
  const page = await jiraFetch(config, path, { what: `wyniki JQL "${jql}"` })
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
  return jiraFetch(config, '/rest/api/2/myself', { what: 'profil użytkownika (myself)' })
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
    { what: project ? `boardy projektu ${project}` : 'lista boardów' },
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
    { what: `sprinty boardu ${boardId}` },
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
    { what: `zadania sprintu ${sprintId}` },
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
    { what: `zadania epica ${epicKey}` },
  )
}

/**
 * All Jira fields (used to auto-detect the Epic Link custom field).
 *
 * @param {object} config
 * @returns {Promise<object[]>}
 */
export function listFields(config) {
  return jiraFetch(config, '/rest/api/2/field', { what: 'lista pól' })
}

/**
 * All statuses (id → name mapping for board configuration columns).
 *
 * @param {object} config
 * @returns {Promise<object[]>}
 */
export function listStatuses(config) {
  return jiraFetch(config, '/rest/api/2/status', { what: 'lista statusów' })
}

/**
 * Project detail: components, issue types, name.
 *
 * @param {object} config
 * @param {string} projectKey
 * @returns {Promise<object>}
 */
export function getProject(config, projectKey) {
  return jiraFetch(config, `/rest/api/2/project/${encodeURIComponent(projectKey)}`, { what: `projekt ${projectKey}` })
}

/**
 * Board configuration (columns → status ids).
 *
 * @param {object} config
 * @param {number} boardId
 * @returns {Promise<object>}
 */
export function getBoardConfiguration(config, boardId) {
  return jiraFetch(config, `/rest/agile/1.0/board/${boardId}/configuration`, { what: `konfiguracja boardu ${boardId}` })
}

// --- write operations (Phase 2, registered only behind JIRA_ALLOW_WRITE) ----

/**
 * Create ONE issue. Pattern proven in references/jira_create_subtasks.mjs.
 *
 * @param {object} config
 * @param {object} fields - Jira issue fields payload
 * @returns {Promise<{key: string}>}
 */
export function createIssue(config, fields) {
  return jiraFetch(config, '/rest/api/2/issue', {
    method: 'POST', body: { fields }, what: 'tworzenie zadania',
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
    method: 'POST', body: { body }, what: `komentarz do ${key}`,
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
    what: `przejścia statusu ${key}`,
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
    method: 'POST', body: { transition: { id: String(transitionId) } }, what: `zmiana statusu ${key}`,
  })
}
