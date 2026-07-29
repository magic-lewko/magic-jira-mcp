/**
 * @fileoverview DEV-ONLY self-test: drives the real MCP tool handlers against a
 * LIVE Jira sandbox (default DC) and prints a pass/fail table. Not shipped with
 * the plugin — this lives in scripts/, outside plugins/jira-tools/.
 *
 * It exercises the FULL tool stack (per-project gate, session budget, duplicate
 * guard, ai-generated label, formatting) with the real jira-client, so it
 * covers what unit tests (mocked) and integration tests (client only) do not:
 * tools + guards + live round-trip.
 *
 * Credentials: JIRA_TEST_SERVER/JIRA_TEST_TOKEN, or repo-local .env.local
 * (VITE_JIRA_SERVER/VITE_JIRA_TOKEN). Sandbox project: JIRA_SELFTEST_PROJECT
 * (default DC). Read phase always runs; write phase needs --write and creates
 * "[selftest] …" tickets that are DELETED at the end (also `--clean` purges any
 * leftover open [selftest] tickets from a crashed run).
 *
 * Usage:
 *   node scripts/selftest.mjs            # read-only checks
 *   node scripts/selftest.mjs --write    # + write cycle (create/update/…/delete)
 *   node scripts/selftest.mjs --clean    # delete leftover [selftest] tickets, exit
 */

import { readFileSync, existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import * as client from '../plugins/jira-tools/src/jira-client.mjs'
import { resetWriteBudget } from '../plugins/jira-tools/src/write-guard.mjs'

import getIssue from '../plugins/jira-tools/src/tools/get-issue.mjs'
import listBoards from '../plugins/jira-tools/src/tools/list-boards.mjs'
import getActiveSprint from '../plugins/jira-tools/src/tools/get-active-sprint.mjs'
import getSprintIssues from '../plugins/jira-tools/src/tools/get-sprint-issues.mjs'
import getChangelog from '../plugins/jira-tools/src/tools/get-issue-changelog.mjs'
import searchIssues from '../plugins/jira-tools/src/tools/search-issues.mjs'
import getCurrentUser from '../plugins/jira-tools/src/tools/get-current-user.mjs'
import createIssue from '../plugins/jira-tools/src/tools/create-issue.mjs'
import updateIssue from '../plugins/jira-tools/src/tools/update-issue.mjs'
import addComment from '../plugins/jira-tools/src/tools/add-comment.mjs'
import addAttachment from '../plugins/jira-tools/src/tools/add-attachment.mjs'
import transitionIssue from '../plugins/jira-tools/src/tools/transition-issue.mjs'
import linkIssues from '../plugins/jira-tools/src/tools/link-issues.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const WRITE = process.argv.includes('--write')
const CLEAN = process.argv.includes('--clean')
const PROJECT = (process.env.JIRA_SELFTEST_PROJECT || 'DC').toUpperCase()
const MARK = '[selftest]'

/** Parse a simple KEY=VALUE .env file. */
function parseEnv(path) {
  if (!existsSync(path)) return {}
  const out = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const i = line.indexOf('=')
    if (i > 0 && !line.trimStart().startsWith('#')) out[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return out
}

const local = parseEnv(join(ROOT, '.env.local'))
const server = (process.env.JIRA_TEST_SERVER || local.VITE_JIRA_SERVER || '').replace(/\/+$/, '')
const token = process.env.JIRA_TEST_TOKEN || local.VITE_JIRA_TOKEN
if (!server || !token) {
  console.error('Missing credentials: set JIRA_TEST_SERVER + JIRA_TEST_TOKEN or .env.local (VITE_JIRA_*).')
  process.exit(1)
}

/** Config for the sandbox project (no write-mode; budget generous for the run). */
const config = {
  server, token, language: 'pl',
  defaultProject: PROJECT,
  projects: {},
  writeBudget: { creates: 50, total: 200 },
}
const ctx = { config, client }

const results = []
const created = []

/**
 * Run one case: fn returns a string detail on success, or throws to fail.
 * `expectError` inverts: the case passes when run throws matching the regex.
 */
async function check(name, fn) {
  try {
    const detail = await fn()
    results.push({ name, ok: true, detail: detail ?? '' })
  } catch (err) {
    results.push({ name, ok: false, detail: err?.message ?? String(err) })
  }
}

/** Invoke a tool handler and return its text (throws on isError). */
async function run(tool, args) {
  const res = await tool.run(args, ctx)
  return res
}

/** Assert helper. */
function must(cond, msg) {
  if (!cond) throw new Error(msg)
}

/** Delete open "[selftest]" tickets left over from crashed runs. */
async function cleanLeftovers() {
  const page = await client.searchIssues(config, {
    jql: `project = ${PROJECT} AND summary ~ "selftest" AND statusCategory != Done`, maxResults: 50,
  })
  const stale = page.issues.filter((i) => (i.fields?.summary ?? '').includes(MARK))
  for (const i of stale) {
    await client.jiraFetch(config, `/rest/api/2/issue/${i.key}?deleteSubtasks=true`, { method: 'DELETE' })
  }
  return stale.map((i) => i.key)
}

async function readPhase() {
  await check('get_current_user (myself)', async () => {
    const t = await run(getCurrentUser, {})
    must(/Logged in as/.test(t), 'missing "Logged in as"')
    return t.split('—')[0].trim()
  })
  await check('list_boards includes the project board(s)', async () => {
    const t = await run(listBoards, { project: PROJECT })
    must(/\d+ —/.test(t), 'no boards')
    return t.split('\n')[0]
  })
  let sprintText
  await check('get_active_sprint', async () => {
    sprintText = await run(getActiveSprint, { board_id: (await client.listBoards(config, { project: PROJECT }))[0]?.id })
    must(/Sprint:/.test(sprintText), 'no active sprint')
    return sprintText.split('\n')[0]
  })
  await check('get_sprint_issues (current sprint)', async () => {
    const boards = await client.listBoards(config, { project: PROJECT })
    const sprint = await client.getActiveSprint(config, boards[0].id)
    const t = await run(getSprintIssues, { sprint_id: sprint.id })
    const n = (t.match(/\n/g) || []).length
    must(n > 0, 'sprint empty')
    return `${n} linii`
  })
  await check('search_issues (arbitrary JQL)', async () => {
    const t = await run(searchIssues, { jql: `project = ${PROJECT} ORDER BY created ASC`, max_results: 5 })
    must(t !== 'No results.', 'empty result for the whole project')
    return t.split('\n')[0]
  })
  await check('get_issue + range expansion', async () => {
    const t = await run(getIssue, { key: `${PROJECT}-1..2` })
    must(t.includes(`${PROJECT}-1`), 'missing the first key')
    return 'range OK'
  })
  await check('get_issue compact mode (default comments)', async () => {
    const t = await run(getIssue, { key: `${PROJECT}-1` })
    must(/DESCRIPTION:/.test(t), 'brak sekcji OPIS')
    return 'format OK'
  })
  await check('get_issue_changelog', async () => {
    const t = await run(getChangelog, { key: `${PROJECT}-1` })
    must(/status history|no status changes/.test(t), 'unexpected changelog format')
    return 'changelog OK'
  })
  await check('search_issues: empty result handled', async () => {
    const t = await run(searchIssues, { jql: `project = ${PROJECT} AND labels = __na_pewno_nie_istnieje__` })
    must(t === 'No results.', 'expected no results')
    return 'OK'
  })
}

async function writePhase() {
  resetWriteBudget()
  const stamp = `${MARK} ${new Date().toISOString().slice(0, 19)}`
  let key

  await check('create_issue (+ ai-generated label)', async () => {
    const t = await run(createIssue, {
      project: PROJECT, issue_type: 'Task', summary: `${stamp} case A`, description: 'selftest',
    })
    key = t.match(/([A-Z]+-\d+)/)?.[1]
    must(key, 'no key in the response')
    created.push(key)
    const issue = await client.getIssue(config, key, { fields: ['labels'] })
    must((issue.fields.labels ?? []).includes('ai-generated'), 'no ai-generated label')
    return `${key} + ai-generated`
  })
  await check('duplicate guard: title of an existing open ticket → refused', async () => {
    // Use an already-indexed open issue — a freshly created one is not yet in
    // Jira's text index (Lucene lag), so back-to-back dupes are a known blind
    // spot; the session budget is the hard rail against loops.
    const existing = await client.getIssue(config, `${PROJECT}-1`, { fields: ['summary'] })
    let refused = false
    try { await run(createIssue, { project: PROJECT, issue_type: 'Task', summary: existing.fields.summary }) }
    catch (e) { refused = /already has an open issue/.test(e.message) }
    must(refused, 'the duplicate guard did not reject a known duplicate')
    return 'refused OK'
  })
  await check('update_issue (labels + priority)', async () => {
    const t = await run(updateIssue, { key, add_labels: ['selftest-label'], priority: 'Medium' })
    must(/Updated/.test(t), 'no confirmation')
    return t.split('—')[0].trim()
  })
  await check('add_comment (+ AI signature)', async () => {
    await run(addComment, { key, body: 'selftest komentarz' })
    const issue = await client.getIssue(config, key)
    const last = issue.fields.comment.comments.at(-1).body
    must(last.includes('ai-generated · jira-tools'), 'no AI signature in the comment')
    return 'signature OK'
  })
  await check('add_attachment (file from disk)', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'selftest-'))
    const file = join(dir, 'selftest.txt')
    writeFileSync(file, 'selftest attachment')
    try {
      const t = await run(addAttachment, { key, path: file })
      must(/Added attachment/.test(t), 'no attachment confirmation')
      return 'attachment OK'
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })
  await check('transition_issue: wrong name → transitions list', async () => {
    let listed = false
    try { await run(transitionIssue, { key, transition_name: '___nonexistent___' }) }
    catch (e) { listed = /Available transitions/.test(e.message) }
    must(listed, 'no list of available transitions')
    return 'list OK'
  })
  await check('transition_issue: valid transition', async () => {
    const { transitions } = await client.listTransitions(config, key)
    must(transitions.length > 0, 'no available transitions')
    const t = await run(transitionIssue, { key, transition_name: transitions[0].name })
    must(/transitioned to/.test(t), 'transition not performed')
    return `→ ${transitions[0].name}`
  })
  await check('link_issues (Relates to a second ticket)', async () => {
    const second = (await run(createIssue, { project: PROJECT, issue_type: 'Task', summary: `${stamp} case B` }))
      .match(/([A-Z]+-\d+)/)?.[1]
    must(second, 'did not create the second ticket to link')
    created.push(second)
    const t = await run(linkIssues, { from: key, to: [second] })
    must(/Linked/.test(t), 'no link confirmation')
    return `${key} ↔ ${second}`
  })
  await check('link_issues: unknown type → available list', async () => {
    let listed = false
    try { await run(linkIssues, { from: key, to: [`${PROJECT}-1`], type: '___nonexistent2___' }) }
    catch (e) { listed = /Available:/.test(e.message) }
    must(listed, 'no list of link types')
    return 'list OK'
  })
  await check('session budget: exhaustion → hard stop', async () => {
    resetWriteBudget()
    const tight = { ...ctx, config: { ...config, writeBudget: { creates: 1, total: 1 } } }
    const tmpKey = (await createIssue.run({ project: PROJECT, issue_type: 'Task', summary: `${stamp} budget` }, tight))
      .match(/([A-Z]+-\d+)/)?.[1]
    if (tmpKey) created.push(tmpKey)
    let stopped = false
    try { await createIssue.run({ project: PROJECT, issue_type: 'Task', summary: `${stamp} budget 2` }, tight) }
    catch (e) { stopped = /Session write limit/.test(e.message) }
    must(stopped, 'the budget did not stop the second creation')
    resetWriteBudget()
    return 'stop OK'
  })
}

async function cleanupCreated() {
  for (const key of created) {
    try { await client.jiraFetch(config, `/rest/api/2/issue/${key}?deleteSubtasks=true`, { method: 'DELETE' }) }
    catch (e) { console.error(`  ! failed to delete ${key}: ${e.message}`) }
  }
}

// --- run ---------------------------------------------------------------------

if (CLEAN) {
  const removed = await cleanLeftovers()
  console.log(removed.length ? `Removed leftovers: ${removed.join(', ')}` : 'No leftover [selftest] tickets.')
  process.exit(0)
}

console.log(`\nSELF-TEST — projekt ${PROJECT} @ ${server}  (${WRITE ? 'read+write' : 'read-only'})\n`)

await readPhase()
if (WRITE) {
  await writePhase()
  console.log(`Cleanup: deleting ${created.length} created tickets…`)
  await cleanupCreated()
}

const pass = results.filter((r) => r.ok).length
const line = '─'.repeat(72)
console.log(line)
for (const r of results) {
  console.log(`${r.ok ? '✓' : '✗'}  ${r.name.padEnd(46)} ${r.detail}`)
}
console.log(line)
console.log(`${pass}/${results.length} passed.${WRITE ? ` Created and deleted: ${created.join(', ') || '—'}.` : ''}\n`)
process.exit(pass === results.length ? 0 : 1)
