/**
 * @fileoverview Fetch and summarize all issues from a Jira project.
 *
 * Read-only. Pages through the Jira Server / Data Center search API and prints
 * a compact overview: status, type, assignee and priority breakdowns plus a
 * per-issue list.
 *
 * Usage (PowerShell):
 *   $env:JIRA_SERVER="https://jira.example.pl"
 *   $env:JIRA_TOKEN="<personal access token>"
 *   node references/jira_list.mjs PROJ
 *
 * Optional:
 *   --json    # dump raw JSON instead of the human summary
 */

/**
 * Strip trailing slashes from a base URL (loop instead of regex to stay linear).
 *
 * @param {string} url
 * @returns {string}
 */
function trimTrailingSlashes(url) {
  let end = url.length
  while (end > 0 && url[end - 1] === '/') end--
  return url.slice(0, end)
}

const JIRA_SERVER = trimTrailingSlashes(process.env.JIRA_SERVER || process.env.VITE_JIRA_SERVER || '')
const TOKEN = process.env.JIRA_TOKEN || process.env.VITE_JIRA_TOKEN
const AS_JSON = process.argv.includes('--json')
const PROJECT = process.argv.slice(2).find((a) => !a.startsWith('--')) || process.env.JIRA_PROJECT

if (!TOKEN) { console.error('Set JIRA_TOKEN'); process.exit(1) }
if (!JIRA_SERVER) { console.error('Set JIRA_SERVER'); process.exit(1) }
if (!PROJECT) { console.error('Pass a project key, e.g. node references/jira_list.mjs PROJ'); process.exit(1) }

const HEADERS = {
  'Authorization': `Bearer ${TOKEN}`,
  'Content-Type': 'application/json',
  'Accept': 'application/json',
}

const FIELDS = [
  'summary', 'status', 'issuetype', 'priority', 'assignee',
  'reporter', 'created', 'updated', 'parent', 'labels', 'fixVersions',
].join(',')

/**
 * Fetch one page of search results.
 *
 * @param {number} startAt - pagination offset
 * @returns {Promise<object>} raw search response page
 */
async function searchPage(startAt) {
  const jql = encodeURIComponent(`project = ${PROJECT} ORDER BY created ASC`)
  const url = `${JIRA_SERVER}/rest/api/2/search?jql=${jql}&fields=${FIELDS}&startAt=${startAt}&maxResults=100`
  const res = await fetch(url, { headers: HEADERS })
  if (!res.ok) throw new Error(`search @${startAt}: ${res.status} — ${await res.text()}`)
  return res.json()
}

/**
 * Page through the search API until every issue is collected.
 *
 * @returns {Promise<{total: number, issues: object[]}>}
 */
async function fetchAll() {
  const all = []
  let startAt = 0
  let total = Infinity
  while (startAt < total) {
    const page = await searchPage(startAt)
    total = page.total
    all.push(...page.issues)
    startAt += page.issues.length
    if (page.issues.length === 0) break
  }
  return { total, issues: all }
}

/**
 * Count issues grouped by an extracted key, sorted by count descending.
 *
 * @param {object[]} issues
 * @param {(issue: object) => string|undefined} pick - group key extractor
 * @returns {[string, number][]}
 */
function tally(issues, pick) {
  const map = new Map()
  for (const it of issues) {
    const k = pick(it) || '(none)'
    map.set(k, (map.get(k) || 0) + 1)
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1])
}

const { total, issues } = await fetchAll()

if (AS_JSON) {
  console.log(JSON.stringify(issues, null, 2))
  process.exit(0)
}

console.log(`PROJECT ${PROJECT} — ${issues.length}/${total} issue(s) fetched\n`)

console.log('STATUS:')
for (const [k, n] of tally(issues, (i) => i.fields.status?.name)) console.log(`  ${String(n).padStart(3)}  ${k}`)
console.log('\nTYPE:')
for (const [k, n] of tally(issues, (i) => i.fields.issuetype?.name)) console.log(`  ${String(n).padStart(3)}  ${k}`)
console.log('\nASSIGNEE:')
for (const [k, n] of tally(issues, (i) => i.fields.assignee?.displayName)) console.log(`  ${String(n).padStart(3)}  ${k}`)
console.log('\nPRIORITY:')
for (const [k, n] of tally(issues, (i) => i.fields.priority?.name)) console.log(`  ${String(n).padStart(3)}  ${k}`)

console.log('\nISSUES:')
for (const it of issues) {
  const f = it.fields
  const parent = f.parent ? ` (parent ${f.parent.key})` : ''
  console.log(
    `  ${it.key.padEnd(11)} [${(f.status?.name || '?').padEnd(14)}] ` +
    `${(f.issuetype?.name || '?').padEnd(8)} — ${f.summary}${parent}` +
    `  · ${f.assignee?.displayName || 'Unassigned'}`,
  )
}
