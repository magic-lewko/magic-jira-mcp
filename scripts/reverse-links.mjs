/**
 * @fileoverview DEV/REPAIR script: flip the direction of existing issue links.
 *
 * jira-tools <= 0.6.0 recorded every directional link the wrong way round
 * (`link_issues` sent `from` as Jira's `outwardIssue`, which Jira treats as the
 * destination — see linkIssues in jira-client.mjs). Links created by those
 * versions read "to blocks from" instead of "from blocks to". This script
 * repairs them: for every link of one type between issues matched by a JQL
 * query it creates the reversed link first, then deletes the old one — so a
 * failure half-way never loses a link.
 *
 * Dry-run by default: it prints the plan and changes nothing without --apply.
 * Only links whose BOTH ends match the JQL are touched; links to issues
 * outside the query are listed as skipped. Symmetric types (e.g. "Relates")
 * do not need this.
 *
 * Credentials: the same as the MCP server — JIRA_SERVER/JIRA_TOKEN env vars or
 * ~/.config/jira-tools/config.json.
 *
 * Usage:
 *   node scripts/reverse-links.mjs "<JQL>" <link type> [--apply]
 *   node scripts/reverse-links.mjs "project = PROJ AND created >= -3d" Blocks
 *   node scripts/reverse-links.mjs "key in (PROJ-1, PROJ-2, PROJ-3)" Blocks --apply
 */

import { loadConfig } from '../plugins/jira-tools/src/config.mjs'
import { jiraFetch, linkIssues, searchIssues } from '../plugins/jira-tools/src/jira-client.mjs'

const [jql, typeName, ...flags] = process.argv.slice(2)
const apply = flags.includes('--apply')

if (!jql || !typeName) {
  console.error('Usage: node scripts/reverse-links.mjs "<JQL>" <link type> [--apply]')
  process.exit(1)
}

const config = loadConfig()
if (!config) {
  console.error('No Jira config: set JIRA_SERVER/JIRA_TOKEN or create ~/.config/jira-tools/config.json.')
  process.exit(1)
}

/**
 * Every issue matched by the JQL, with its issuelinks (all pages, capped).
 *
 * @returns {Promise<object[]>}
 */
async function matchedIssues() {
  const issues = []
  let startAt = 0
  for (;;) {
    const page = await searchIssues(config, { jql, fields: ['issuelinks'], maxResults: 100, startAt })
    issues.push(...page.issues)
    if (issues.length >= page.total || page.issues.length === 0) return issues
    startAt = issues.length
    if (startAt >= 2000) {
      console.error(`Stopping at ${startAt} issues — narrow the JQL.`)
      return issues
    }
  }
}

const issues = await matchedIssues()
const matched = new Set(issues.map((i) => i.key))
const wanted = typeName.trim().toLowerCase()

/** @type {Map<string, {id: string, source: string, destination: string, outward: string}>} */
const links = new Map()
for (const issue of issues) {
  for (const link of issue.fields?.issuelinks ?? []) {
    if (link.type?.name?.toLowerCase() !== wanted) continue
    // On issue X: `outwardIssue: Y` means "X <outward> Y" (X is the source);
    // `inwardIssue: Y` means "X <inward> Y" (Y is the source).
    const entry = link.outwardIssue
      ? { id: link.id, source: issue.key, destination: link.outwardIssue.key, outward: link.type.outward }
      : { id: link.id, source: link.inwardIssue.key, destination: issue.key, outward: link.type.outward }
    links.set(link.id, entry)
  }
}

const inScope = [...links.values()].filter((l) => matched.has(l.source) && matched.has(l.destination))
const skipped = [...links.values()].filter((l) => !matched.has(l.source) || !matched.has(l.destination))

console.log(`JQL matched ${issues.length} issues; ${links.size} "${typeName}" links found, ${inScope.length} with both ends in scope.`)
for (const l of inScope) {
  console.log(`  ${l.source} ${l.outward} ${l.destination}   ->   ${l.destination} ${l.outward} ${l.source}`)
}
if (skipped.length) {
  console.log('Skipped (one end outside the JQL):')
  for (const l of skipped) console.log(`  ${l.source} ${l.outward} ${l.destination}`)
}

if (apply) {
  await flipAll()
} else {
  console.log('\nDry run — nothing changed. Re-run with --apply to flip the links listed above.')
}

/**
 * Flip every in-scope link. Stops at the first failure with a non-zero exit
 * code — set via process.exitCode, not process.exit(): exiting with fetch
 * connections still open trips a libuv assertion on Windows.
 */
async function flipAll() {
  let done = 0
  for (const l of inScope) {
    // Create the reversed link first, then delete the old one: a failure leaves
    // both links in place (visible, fixable) rather than none.
    await linkIssues(config, { type: typeName, from: l.destination, to: l.source })
    try {
      await jiraFetch(config, `/rest/api/2/issueLink/${l.id}`, { method: 'DELETE', what: `delete link ${l.id}` })
    } catch (err) {
      console.error(`Reversed link created but the old one (id ${l.id}: ${l.source} ${l.outward} ${l.destination}) `
        + `could not be deleted: ${err.message}. Remove it by hand.`)
      process.exitCode = 1
      return
    }
    done += 1
    console.log(`  flipped ${l.source} -> ${l.destination}  (${done}/${inScope.length})`)
  }
  console.log(`\nDone: ${done} links flipped.`)
}
