/**
 * @fileoverview Server-side safety rails for write operations.
 *
 * There is NO "write-mode" — writes are available by default. What remains
 * guards against AI mistakes (not user competence):
 *
 * 1. Session write budget — a per-process counter. Once exhausted, every write
 *    fails until the server is restarted (/reload-plugins). This is the hard
 *    stop for runaway loops mass-creating issues. A bulk call checks the whole
 *    batch up front (assertWriteBudget) so it refuses before creating anything.
 * 2. Duplicate guard — refuses to create an issue whose normalized summary
 *    matches an existing open issue in the same project, unless the caller
 *    explicitly passes allow_duplicate. Scoped to the parent for sub-tasks,
 *    because sub-task titles legitimately repeat across stories.
 *
 * Plus, per issue-creation flow: /create-task's mandatory dry-run and Claude
 * Code's own per-tool permission prompts.
 */

import { debug, JiraError } from './jira-client.mjs'

/**
 * Defaults when config carries no writeBudget. High enough that normal batch
 * work (dozens of tickets) runs without hitting it — this is a runaway-loop
 * guard, not a usage cap. Raise per config/env when you genuinely need more.
 */
export const DEFAULT_WRITE_BUDGET = { creates: 100, total: 300 }

const counters = { creates: 0, total: 0 }

/** Reset the session counters — tests only. */
export function resetWriteBudget() {
  counters.creates = 0
  counters.total = 0
}

/**
 * @param {{writeBudget?: {creates?: number, total?: number}}} config
 * @returns {{creates: number, total: number}}
 */
function effectiveBudget(config) {
  return { ...DEFAULT_WRITE_BUDGET, ...config?.writeBudget }
}

/**
 * @param {number} used
 * @param {number} limit
 * @param {string} what
 * @param {number} count - how many writes were requested
 */
function refuse(used, limit, what, count) {
  const head = count > 1
    ? `Session write limit would be exceeded (${used}/${limit} used, ${count} more requested — ${what}). `
    : `Session write limit reached (${used}/${limit} — ${what}). `
  throw new JiraError(
    head
    + 'This is a loop guard, not a hard cap. Raise it in ~/.config/jira-tools/config.json with '
    + '"writeBudget": { "creates": 200, "total": 500 } (both are plain integers), or set env '
    + 'JIRA_WRITE_BUDGET_CREATES / JIRA_WRITE_BUDGET_TOTAL to integers. Then restart the server '
    + '(/reload-plugins in Claude Code).',
  )
}

/**
 * Throw when `count` more writes of `kind` would exceed the session budget —
 * WITHOUT consuming anything. Lets a bulk call refuse up front (nothing
 * created) instead of dying half-way through a batch.
 *
 * @param {{writeBudget?: {creates?: number, total?: number}}} config
 * @param {'create'|'write'} kind - 'create' counts against both limits
 * @param {number} [count]
 */
export function assertWriteBudget(config, kind, count = 1) {
  const budget = effectiveBudget(config)
  if (counters.total + count > budget.total) refuse(counters.total, budget.total, 'all writes', count)
  if (kind === 'create' && counters.creates + count > budget.creates) {
    refuse(counters.creates, budget.creates, 'issue creation', count)
  }
}

/**
 * Consume one unit of the session write budget or throw a user-facing error.
 * Call it immediately BEFORE the actual write request.
 *
 * @param {{writeBudget?: {creates?: number, total?: number}}} config
 * @param {'create'|'write'} kind - 'create' counts against both limits
 */
export function consumeWriteBudget(config, kind) {
  assertWriteBudget(config, kind, 1)
  counters.total += 1
  if (kind === 'create') counters.creates += 1
}

/**
 * Used/limit counters for this session — surfaced by get_version so a caller
 * can check the headroom before starting a big batch.
 *
 * @param {{writeBudget?: {creates?: number, total?: number}}} config
 * @returns {{creates: {used: number, limit: number}, total: {used: number, limit: number}}}
 */
export function writeBudgetStatus(config) {
  const budget = effectiveBudget(config)
  return {
    creates: { used: counters.creates, limit: budget.creates },
    total: { used: counters.total, limit: budget.total },
  }
}

/**
 * Normalize a summary for duplicate comparison: case- and whitespace-insensitive.
 *
 * @param {string} summary
 * @returns {string}
 */
function normalizeSummary(summary) {
  return String(summary ?? '').toLowerCase().replaceAll(/\s+/g, ' ').trim()
}

/**
 * Build a safe JQL text operand from a summary. Jira parses `summary ~ "..."`
 * with Lucene, where special characters break the query even inside quotes
 * (e.g. "[" starts a range query → HTTP 400). They are replaced with spaces —
 * no precision is lost, because the definitive comparison happens in code on
 * the returned candidates, not in JQL.
 *
 * @param {string} summary
 * @returns {string}
 */
function jqlTextOperand(summary) {
  return String(summary)
    .replaceAll(/[+\-&|!(){}[\]^"~*?:\\/]/g, ' ')
    .replaceAll(/\s+/g, ' ')
    .trim()
}

/**
 * Find an existing OPEN issue whose summary matches (after normalization).
 * Scoped to the whole project, or to one parent when `parent` is given —
 * sub-task titles like "FT" or "Config" legitimately repeat across stories.
 * Returns the issue or null. Best-effort: when the check itself fails (exotic
 * Jira quirks), creation proceeds — the session budget remains the hard rail.
 *
 * @param {object} config
 * @param {{searchIssues: Function}} client - injected for testability
 * @param {string} project - project key (uppercase)
 * @param {string} summary - candidate summary
 * @param {{parent?: string}} [opts] - parent key to scope the search to
 * @returns {Promise<object|null>}
 */
export async function findDuplicate(config, client, project, summary, { parent } = {}) {
  const wanted = normalizeSummary(summary)
  if (!wanted) return null
  const operand = jqlTextOperand(summary)
  if (!operand) return null
  const scope = parent ? ` AND parent = ${String(parent).toUpperCase()}` : ''
  const jql = `project = ${project} AND summary ~ "${operand}"${scope} AND statusCategory != Done`
  try {
    const page = await client.searchIssues(config, { jql, maxResults: 20 })
    return page.issues.find((issue) => normalizeSummary(issue.fields?.summary) === wanted) ?? null
  } catch (err) {
    debug('duplicate check failed, proceeding without it:', err?.message)
    return null
  }
}
