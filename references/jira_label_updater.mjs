/**
 * @fileoverview Apply a label to every Jira issue referenced in a git ref range.
 *
 * Intended to run before merging — extracts issue keys from commit messages
 * between two refs and adds the given label to each ticket. Existing labels
 * are preserved; issues that already carry the label are skipped.
 *
 * Commit message convention required:
 *   type(PROJ-123): description
 *   e.g. fix(PROJ-123): correct payment rounding
 *
 * Usage:
 *   JIRA_SERVER=<url> JIRA_TOKEN=<token> node references/jira_label_updater.mjs <label> <base-ref> <head-ref>
 *   e.g. node references/jira_label_updater.mjs UAT origin/develop origin/release
 */

import { execSync } from 'node:child_process'

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
const [LABEL, BASE, HEAD] = process.argv.slice(2)

if (!TOKEN) { console.error('Set JIRA_TOKEN'); process.exit(1) }
if (!JIRA_SERVER) { console.error('Set JIRA_SERVER'); process.exit(1) }
if (!LABEL || !BASE || !HEAD) {
  console.error('Usage: node references/jira_label_updater.mjs <label> <base-ref> <head-ref>')
  process.exit(1)
}

const HEADERS = {
  'Authorization': `Bearer ${TOKEN}`,
  'Content-Type': 'application/json',
  'Accept': 'application/json',
}

/**
 * Parse the git log between two refs and extract unique Jira issue keys.
 * Relies on commit messages following the `type(PROJ-123): description` convention.
 *
 * @returns {string[]} deduplicated issue keys, e.g. ['PROJ-123', 'PROJ-124']
 */
function getIssuesFromGit() {
  try {
    const log = execSync(`git log ${BASE}..${HEAD} --oneline`, {
      encoding: 'utf8',
      timeout: 10_000,
    })
    const keys = [...new Set(log.match(/\b[A-Z]+-\d+\b/g) ?? [])]
    if (!keys.length) console.warn('No issue keys found in log — empty diff?')
    return keys
  } catch (err) {
    console.error(`git log failed: ${err.message}`)
    process.exit(1)
  }
}

/**
 * Add the label to a single issue, preserving existing labels and skipping
 * the update entirely when the label is already present.
 *
 * @param {string} issueKey - Jira issue key, e.g. 'PROJ-123'
 * @returns {Promise<void>}
 */
async function addLabel(issueKey) {
  const getRes = await fetch(
    `${JIRA_SERVER}/rest/api/2/issue/${issueKey}?fields=labels`,
    { headers: HEADERS },
  )

  if (!getRes.ok) {
    console.error(`  ${issueKey}: GET ${getRes.status} — ${await getRes.text()}`)
    return
  }

  const { fields } = await getRes.json()
  const current = fields?.labels ?? []

  if (current.includes(LABEL)) {
    console.log(`  ${issueKey}: already has '${LABEL}', skipping`)
    return
  }

  const putRes = await fetch(`${JIRA_SERVER}/rest/api/2/issue/${issueKey}`, {
    method: 'PUT',
    headers: HEADERS,
    body: JSON.stringify({ fields: { labels: [...current, LABEL] } }),
  })

  if (!putRes.ok) {
    console.error(`  ${issueKey}: PUT ${putRes.status} — ${await putRes.text()}`)
    return
  }

  console.log(`  ${issueKey}: added '${LABEL}'`)
}

const keys = getIssuesFromGit()
console.log(`Found ${keys.length} issue(s) for ${LABEL}`)

const results = await Promise.allSettled(keys.map(addLabel))

const failed = results.filter((r) => r.status === 'rejected')
if (failed.length) {
  console.error(`\n${failed.length} issue(s) failed unexpectedly:`)
  failed.forEach((r) => console.error(' ', r.reason))
}
