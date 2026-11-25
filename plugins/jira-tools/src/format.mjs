/**
 * @fileoverview Compact, LLM-friendly text formatting of Jira entities.
 *
 * Tools return these strings verbatim (SPEC §4: concise text, never raw JSON).
 * Layouts follow the original proven fetch/format patterns. All strings are
 * English (repo is English-only; only generated ticket content follows JIRA_LANG).
 */

const SEPARATOR = '─'.repeat(60)

/** Context economy (SPEC §4.3): default caps for get_issue output. */
const COMMENT_LIMIT = 5
const DESCRIPTION_LIMIT = 4000

/**
 * ISO timestamp → YYYY-MM-DD (Jira dates are ISO with offset).
 *
 * @param {string|undefined} iso
 * @returns {string}
 */
function day(iso) {
  return iso ? String(iso).slice(0, 10) : '?'
}

/**
 * One compact line per issue: key, status, type, priority, title, assignee,
 * labels, updated (field set of SPEC §4.1).
 *
 * @param {object} issue - raw Jira issue with LIST_FIELDS
 * @returns {string}
 */
export function formatIssueLine(issue) {
  const f = issue.fields ?? {}
  const parts = [
    `${issue.key} [${f.status?.name ?? '?'}]`,
    `${f.issuetype?.name ?? '?'}/${f.priority?.name ?? '?'}`,
    `— ${f.summary ?? '(no title)'}`,
    `· ${f.assignee?.displayName ?? 'Unassigned'}`,
  ]
  if ((f.labels ?? []).length) parts.push(`· labels: ${f.labels.join(',')}`)
  if (f.updated) parts.push(`· upd: ${day(f.updated)}`)
  return parts.join(' ')
}

/**
 * A list of issues plus the mandatory truncation note when not all results
 * are shown (SPEC §4.3).
 *
 * @param {{issues: object[], total: number, startAt?: number}} page
 * @returns {string}
 */
export function formatIssueList({ issues, total, startAt = 0 }) {
  if (issues.length === 0) return 'No results.'
  const lines = issues.map(formatIssueLine)
  const shown = startAt + issues.length
  if (shown < total) {
    lines.push(`(showing ${shown} of ${total} — narrow the JQL or raise max_results)`)
  }
  return lines.join('\n')
}

/**
 * Description block, capped unless `full` (context economy).
 *
 * @param {object} fields
 * @param {boolean} full
 * @returns {string[]}
 */
function descriptionBlock(fields, full) {
  let description = (fields.description ?? '(no description)').trim() || '(no description)'
  if (!full && description.length > DESCRIPTION_LIMIT) {
    description = `${description.slice(0, DESCRIPTION_LIMIT)}\n… (description truncated — full text: all_comments=true)`
  }
  return ['', 'DESCRIPTION:', description]
}

/**
 * Attachments block (names + URLs), empty array when none.
 *
 * @param {object} fields
 * @returns {string[]}
 */
function attachmentsBlock(fields) {
  const atts = fields.attachment ?? []
  if (atts.length === 0) return []
  return ['', `ATTACHMENTS (${atts.length}):`, ...atts.map((a) => `- ${a.filename}  ${a.content}`)]
}

/**
 * Comments block — by default only the COMMENT_LIMIT most recent ones, with
 * an explicit truncation note; `full` lifts the cap.
 *
 * @param {object} fields
 * @param {boolean} full
 * @returns {string[]}
 */
function commentsBlock(fields, full) {
  const comments = fields.comment?.comments ?? []
  if (comments.length === 0) return []
  const shown = full || comments.length <= COMMENT_LIMIT ? comments : comments.slice(-COMMENT_LIMIT)
  const header = shown.length === comments.length
    ? `COMMENTS (${comments.length}):`
    : `COMMENTS (showing the last ${shown.length} of ${comments.length} — full list: all_comments=true):`
  const lines = ['', header]
  for (const c of shown) {
    lines.push(
      `• ${c.author?.displayName ?? '?'} (${day(c.created)}):`,
      `  ${(c.body ?? '').trim().replaceAll('\n', '\n  ')}`,
    )
  }
  return lines
}

/**
 * Full single-issue detail: header, meta, description, attachments, comments
 * + browse URL.
 *
 * Context economy: by default the description is capped and only the most
 * recent comments are rendered (with explicit notes); `full: true` (tool param
 * all_comments) lifts both caps.
 *
 * @param {object} issue - raw Jira issue with DETAIL_FIELDS
 * @param {{server?: string, full?: boolean}} [opts]
 * @returns {string}
 */
export function formatIssueFull(issue, { server, full = false } = {}) {
  const f = issue.fields ?? {}
  const out = [
    `${issue.key} — ${f.summary ?? '(no title)'}`,
    `${f.issuetype?.name ?? '?'} · ${f.priority?.name ?? '?'} · ${f.status?.name ?? '?'}`
    + ` · ${f.assignee?.displayName ?? 'Unassigned'}`
    + ` · reporter: ${f.reporter?.displayName ?? '?'}`,
  ]

  const meta = []
  if ((f.components ?? []).length) meta.push(`components: ${f.components.map((c) => c.name).join(', ')}`)
  if ((f.labels ?? []).length) meta.push(`labels: ${f.labels.join(', ')}`)
  if ((f.fixVersions ?? []).length) meta.push(`fixVersions: ${f.fixVersions.map((v) => v.name).join(', ')}`)
  if (f.parent) meta.push(`parent/epic: ${f.parent.key} (${f.parent.fields?.summary ?? '?'})`)
  meta.push(`created: ${day(f.created)}, updated: ${day(f.updated)}`)
  out.push(meta.join(' · '))

  if (server) out.push(`${server}/browse/${issue.key}`)
  out.push(...descriptionBlock(f, full), ...attachmentsBlock(f), ...commentsBlock(f, full))
  return out.join('\n')
}

/**
 * Several issues in full detail, separated visually.
 *
 * @param {object[]} issues
 * @param {{server?: string, full?: boolean}} [opts]
 * @returns {string}
 */
export function formatIssuesFull(issues, opts = {}) {
  return issues.map((i) => formatIssueFull(i, opts)).join(`\n${SEPARATOR}\n`)
}

/**
 * Sprint header: name, state, dates, goal.
 *
 * @param {object} sprint - Agile API sprint object
 * @returns {string}
 */
export function formatSprint(sprint) {
  const lines = [`Sprint: ${sprint.name} (${sprint.state}, id: ${sprint.id})`]
  lines.push(`Dates: ${day(sprint.startDate)} → ${day(sprint.endDate)}`)
  if (sprint.goal) lines.push(`Goal: ${sprint.goal}`)
  return lines.join('\n')
}

/**
 * Board list, one line each.
 *
 * @param {object[]} boards - Agile API board objects
 * @returns {string}
 */
export function formatBoards(boards) {
  if (boards.length === 0) return 'No boards.'
  return boards
    .map((b) => {
      const project = b.location?.projectKey ? `, project: ${b.location.projectKey}` : ''
      return `${b.id} — ${b.name} (${b.type}${project})`
    })
    .join('\n')
}

/**
 * Status-change history extracted from an expanded changelog: date, author,
 * from → to. Non-status items are skipped.
 *
 * @param {object} issue - issue fetched with expand=changelog
 * @returns {string}
 */
export function formatChangelog(issue) {
  const histories = issue.changelog?.histories ?? []
  const lines = []
  for (const h of histories) {
    for (const item of h.items ?? []) {
      if (item.field !== 'status') continue
      lines.push(`${day(h.created)}  ${item.fromString ?? '?'} → ${item.toString ?? '?'}  (${h.author?.displayName ?? '?'})`)
    }
  }
  if (lines.length === 0) return `${issue.key}: no status changes in history.`
  return [`${issue.key} — status history:`, ...lines].join('\n')
}

/**
 * Epic roll-up: per-status counts + the list of not-done children.
 * "Open" means Jira statusCategory !== done.
 *
 * @param {string} epicKey
 * @param {{issues: object[], total: number}} result
 * @returns {string}
 */
export function formatEpicStatus(epicKey, { issues, total }) {
  if (issues.length === 0) return `Epic ${epicKey}: no linked issues.`

  const counts = new Map()
  for (const issue of issues) {
    const status = issue.fields?.status?.name ?? '?'
    counts.set(status, (counts.get(status) ?? 0) + 1)
  }
  const open = issues.filter((i) => i.fields?.status?.statusCategory?.key !== 'done')

  const ofTotal = issues.length < total ? ` (of ${total})` : ''
  const out = [`Epic ${epicKey} — ${issues.length} issues${ofTotal}:`]
  for (const [status, n] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
    out.push(`  ${String(n).padStart(3)}  ${status}`)
  }
  if (open.length) {
    out.push('', `Open (${open.length}):`)
    for (const issue of open) out.push(formatIssueLine(issue))
  } else {
    out.push('', 'All issues closed.')
  }
  return out.join('\n')
}

// --- Zephyr Squad Server -----------------------------------------------------

/**
 * @param {string} text
 * @param {number} max
 * @returns {string}
 */
function clip(text, max) {
  const flat = String(text ?? '').replaceAll(/\s+/g, ' ').trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}

/**
 * Status name of an execution: ZQL results carry `status.name`, the execution
 * endpoints only the id in `executionStatus`.
 *
 * @param {object} execution
 * @param {Map<string, string>} [statusNames] - id → name
 * @returns {string}
 */
export function executionStatusName(execution, statusNames) {
  const id = execution.executionStatus === undefined ? undefined : String(execution.executionStatus)
  return execution.status?.name ?? (id ? statusNames?.get(id) ?? id : '?')
}

/**
 * One compact line per execution: id, status, test, cycle / folder, version,
 * who and when, defects, comment.
 *
 * @param {object} execution - ZQL execution object
 * @param {Map<string, string>} [statusNames]
 * @returns {string}
 */
export function formatExecutionLine(execution, statusNames) {
  const e = execution
  const where = e.folderName ? `${e.cycleName ?? '?'} / ${e.folderName}` : (e.cycleName ?? '?')
  const parts = [
    `#${e.id} ${executionStatusName(e, statusNames)}`,
    `${e.issueKey ?? '?'} — ${clip(e.issueSummary ?? e.summary ?? '(no title)', 90)}`,
    `· ${where}`,
    `· ${e.versionName ?? 'Unscheduled'}`,
  ]
  const who = e.executedByDisplay || e.executedBy
  if (who || e.executedOn) parts.push(`· by ${who || '?'} ${e.executedOn ?? ''}`.trimEnd())
  if (e.totalDefectCount) parts.push(`· defects: ${e.totalDefectCount}`)
  if (e.comment) parts.push(`· comment: "${clip(e.comment, 120)}"`)
  return parts.join(' ')
}

/**
 * Per-status counts, most frequent first, e.g. "PASS 12 · FAIL 2 · UNEXECUTED 5".
 *
 * @param {object[]} executions
 * @param {Map<string, string>} [statusNames]
 * @returns {string}
 */
export function formatStatusCounts(executions, statusNames) {
  const counts = new Map()
  for (const e of executions) {
    const name = executionStatusName(e, statusNames)
    counts.set(name, (counts.get(name) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([name, n]) => `${name} ${n}`).join(' · ')
}

/**
 * Executions list plus the truncation note when not all results are shown.
 *
 * @param {{executions: object[], total: number}} page
 * @param {Map<string, string>} [statusNames]
 * @returns {string}
 */
export function formatExecutionList({ executions, total }, statusNames) {
  if (executions.length === 0) return 'No executions.'
  const lines = executions.map((e) => formatExecutionLine(e, statusNames))
  const shown = executions.length < total ? `${executions.length} of ${total} shown` : `${total}`
  lines.push('', `Statuses (${shown}): ${formatStatusCounts(executions, statusNames)}`)
  if (executions.length < total) {
    lines.push(`(showing ${executions.length} of ${total} — narrow the ZQL or raise max_results)`)
  }
  return lines.join('\n')
}

/**
 * Test steps: number, action, test data, expected result.
 *
 * @param {{orderId?: number, step?: string, data?: string, result?: string}[]} steps
 * @returns {string[]}
 */
export function formatTestSteps(steps) {
  if (steps.length === 0) return ['', 'STEPS: none']
  const lines = ['', `STEPS (${steps.length}):`]
  steps.forEach((s, index) => {
    lines.push(`${s.orderId ?? index + 1}. ${String(s.step ?? '').trim() || '(empty)'}`)
    if (String(s.data ?? '').trim()) lines.push(`   Data: ${String(s.data).trim().replaceAll('\n', '\n   ')}`)
    if (String(s.result ?? '').trim()) lines.push(`   Expected: ${String(s.result).trim().replaceAll('\n', '\n   ')}`)
  })
  return lines
}

/**
 * One test cycle line: id, name, version, environment, build, dates, progress.
 *
 * @param {object} cycle - cycle object with numeric `id`
 * @param {{executed: number, total: number, folders: number}} totals
 * @returns {string}
 */
export function formatCycleLine(cycle, { executed, total, folders }) {
  const parts = [`#${cycle.id} ${cycle.name ?? '?'}`, `· version: ${cycle.versionName ?? 'Unscheduled'}`]
  if (cycle.environment) parts.push(`· env: ${cycle.environment}`)
  if (cycle.build) parts.push(`· build: ${cycle.build}`)
  if (cycle.startDate || cycle.endDate) parts.push(`· ${cycle.startDate || '?'} → ${cycle.endDate || '?'}`)
  parts.push(`· executed ${executed}/${total}`)
  if (folders) parts.push(`· folders: ${folders}`)
  return parts.join(' ')
}
