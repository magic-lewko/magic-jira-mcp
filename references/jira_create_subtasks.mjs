/**
 * @fileoverview Batch-create sub-tasks under existing parent issues from a JSON plan.
 *
 * Read-safe by default: prints exactly what WOULD be created. Pass `--apply`
 * to actually POST. Instance-specific ids (sub-task issue type, components)
 * live in the plan file, since they differ per Jira instance — nothing
 * company-specific is hardcoded here.
 *
 * Plan file shape:
 *   {
 *     "project": "PROJ",
 *     "subtaskTypeId": "10101",
 *     "componentIds": ["12103"],
 *     "plan": [
 *       { "parent": "PROJ-1", "subs": ["Component X - mock", "Component X - rwd"] }
 *     ]
 *   }
 *
 * Usage (PowerShell):
 *   $env:JIRA_SERVER="https://jira.example.pl"
 *   $env:JIRA_TOKEN="<personal access token>"
 *   node references/jira_create_subtasks.mjs plan.json            # dry-run
 *   node references/jira_create_subtasks.mjs plan.json --apply    # actually create
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
const PLAN_FILE = process.argv.slice(2).find((a) => !a.startsWith('--'))

if (!TOKEN) { console.error('Set JIRA_TOKEN'); process.exit(1) }
if (!JIRA_SERVER) { console.error('Set JIRA_SERVER'); process.exit(1) }
if (!PLAN_FILE) { console.error('Pass a plan file, e.g. node references/jira_create_subtasks.mjs plan.json'); process.exit(1) }

const HEADERS = {
  'Authorization': `Bearer ${TOKEN}`,
  'Content-Type': 'application/json',
  'Accept': 'application/json',
}

/**
 * Load and minimally validate the plan file.
 *
 * @param {string} file - path to the JSON plan
 * @returns {{project: string, subtaskTypeId: string, componentIds: string[], plan: {parent: string, subs: string[]}[]}}
 */
function loadPlan(file) {
  const data = JSON.parse(readFileSync(file, 'utf8'))
  for (const field of ['project', 'subtaskTypeId', 'plan']) {
    if (!data[field]) { console.error(`Plan file is missing "${field}"`); process.exit(1) }
  }
  return { componentIds: [], ...data }
}

/**
 * Create a single sub-task under a parent issue.
 *
 * @param {ReturnType<typeof loadPlan>} plan
 * @param {string} parent - parent issue key
 * @param {string} summary - sub-task summary
 * @returns {Promise<string>} created issue key
 */
async function createSubtask(plan, parent, summary) {
  const body = {
    fields: {
      project: { key: plan.project },
      parent: { key: parent },
      summary,
      issuetype: { id: plan.subtaskTypeId },
      components: plan.componentIds.map((id) => ({ id })),
    },
  }
  const res = await fetch(`${JIRA_SERVER}/rest/api/2/issue`, {
    method: 'POST', headers: HEADERS, body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${parent} "${summary}": ${res.status} — ${await res.text()}`)
  return (await res.json()).key
}

const plan = loadPlan(PLAN_FILE)
const total = plan.plan.reduce((n, p) => n + p.subs.length, 0)
console.log(`${APPLY ? 'APPLYING' : 'DRY-RUN'} — ${total} sub-task(s) across ${plan.plan.length} parent(s) in ${plan.project}\n`)

let created = 0
const errors = []
for (const { parent, subs } of plan.plan) {
  console.log(parent)
  for (const summary of subs) {
    if (!APPLY) {
      console.log(`   + ${summary}`)
      continue
    }
    try {
      const key = await createSubtask(plan, parent, summary)
      console.log(`   ✓ ${key}  ${summary}`)
      created++
    } catch (e) {
      console.log(`   ✗ FAILED  ${summary}`)
      errors.push(e.message)
    }
  }
}

if (APPLY) {
  console.log(`\nCreated ${created}/${total} sub-task(s).`)
  if (errors.length) { console.error(`\n${errors.length} error(s):`); errors.forEach((m) => console.error('  ' + m)) }
} else {
  console.log(`\nDry-run only. Re-run with --apply to create them.`)
}
