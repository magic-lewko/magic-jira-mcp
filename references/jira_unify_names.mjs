/**
 * @fileoverview Batch-rename issue summaries from a JSON map — safely.
 *
 * SAFE: each row carries the exact expected current summary ("before"). The
 * script GETs the issue and only renames when the live summary still matches —
 * so nothing already-renamed or unexpected is ever touched. Dry-run by default.
 *
 * Map file shape (array of rows):
 *   [
 *     { "key": "PROJ-24", "before": "[F] mock header", "after": "App Header - mock" }
 *   ]
 *
 * Usage:
 *   JIRA_SERVER=<url> JIRA_TOKEN=<token> node references/jira_unify_names.mjs renames.json           # dry-run
 *   JIRA_SERVER=<url> JIRA_TOKEN=<token> node references/jira_unify_names.mjs renames.json --apply
 */

import { readFileSync } from 'node:fs'

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
const APPLY = process.argv.includes('--apply')
const MAP_FILE = process.argv.slice(2).find((a) => !a.startsWith('--'))

if (!TOKEN) { console.error('Set JIRA_TOKEN'); process.exit(1) }
if (!JIRA_SERVER) { console.error('Set JIRA_SERVER'); process.exit(1) }
if (!MAP_FILE) { console.error('Pass a map file, e.g. node references/jira_unify_names.mjs renames.json'); process.exit(1) }

const HEADERS = {
  'Authorization': `Bearer ${TOKEN}`,
  'Content-Type': 'application/json',
  'Accept': 'application/json',
}

/**
 * Load and minimally validate the rename map.
 *
 * @param {string} file - path to the JSON map
 * @returns {{key: string, before: string, after: string}[]}
 */
function loadMap(file) {
  const rows = JSON.parse(readFileSync(file, 'utf8'))
  if (!Array.isArray(rows) || rows.some((r) => !r.key || !r.before || !r.after)) {
    console.error('Map file must be an array of { key, before, after } rows')
    process.exit(1)
  }
  return rows
}

/**
 * Fetch the live summary of an issue.
 *
 * @param {string} key - issue key
 * @returns {Promise<string>} current summary
 */
async function getSummary(key) {
  const res = await fetch(`${JIRA_SERVER}/rest/api/2/issue/${key}?fields=summary`, { headers: HEADERS })
  if (!res.ok) throw new Error(`GET ${key}: ${res.status} — ${await res.text()}`)
  return (await res.json()).fields.summary
}

/**
 * Overwrite the summary of an issue.
 *
 * @param {string} key - issue key
 * @param {string} summary - new summary
 * @returns {Promise<void>}
 */
async function rename(key, summary) {
  const res = await fetch(`${JIRA_SERVER}/rest/api/2/issue/${key}`, {
    method: 'PUT', headers: HEADERS, body: JSON.stringify({ fields: { summary } }),
  })
  if (!res.ok) throw new Error(`PUT ${key}: ${res.status} — ${await res.text()}`)
}

const MAP = loadMap(MAP_FILE)
console.log(`${APPLY ? 'APPLYING' : 'DRY-RUN'} — ${MAP.length} issue(s)\n`)

let done = 0
let skipped = 0
const errors = []
for (const { key, before, after } of MAP) {
  let live
  try { live = await getSummary(key) } catch (e) { console.log(`✗ ${key} — ${e.message}`); errors.push(e.message); continue }

  if (live === after) { console.log(`= ${key.padEnd(9)} already "${after}"`); skipped++; continue }
  if (live !== before) {
    console.log(`⚠ ${key.padEnd(9)} SKIP — live summary "${live}" != expected "${before}"`)
    skipped++
    continue
  }

  if (!APPLY) { console.log(`  ${key.padEnd(9)} "${before}"  →  "${after}"`); continue }
  try { await rename(key, after); console.log(`✓ ${key.padEnd(9)} → "${after}"`); done++ }
  catch (e) { console.log(`✗ ${key} — ${e.message}`); errors.push(e.message) }
}

console.log(`\n${APPLY ? `Renamed ${done}` : 'Would rename'} / ${MAP.length} (skipped ${skipped}).`)
if (errors.length) { console.error(`\n${errors.length} error(s):`); errors.forEach((m) => console.error('  ' + m)) }
if (!APPLY) console.log('Dry-run only. Re-run with --apply.')
