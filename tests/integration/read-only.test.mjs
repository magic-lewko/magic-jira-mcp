/**
 * @fileoverview Opt-in, STRICTLY READ-ONLY integration tests against a live
 * Jira Server (SPEC §8.2). They run only when credentials are present:
 *
 *   JIRA_TEST_SERVER + JIRA_TEST_TOKEN   (preferred)
 *   or the repo-local .env.local with VITE_JIRA_SERVER / VITE_JIRA_TOKEN
 *
 * Optional: JIRA_TEST_PROJECT (default "DC"), JIRA_TEST_ISSUE (default "DC-16").
 * Nothing here creates, comments on, or transitions anything.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { getMyself, searchIssues, getIssue } from '../../plugins/jira-tools/src/jira-client.mjs'

/** Parse a simple KEY=VALUE .env file (no quotes/expansion needed here). */
function parseEnvFile(path) {
  if (!existsSync(path)) return {}
  const out = {}
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const idx = line.indexOf('=')
    if (idx <= 0 || line.trimStart().startsWith('#')) continue
    out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
  }
  return out
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const local = parseEnvFile(join(root, '.env.local'))

const server = process.env.JIRA_TEST_SERVER || local.VITE_JIRA_SERVER
const token = process.env.JIRA_TEST_TOKEN || local.VITE_JIRA_TOKEN
const PROJECT = process.env.JIRA_TEST_PROJECT || 'DC'
const ISSUE = process.env.JIRA_TEST_ISSUE || 'DC-16'

const skip = (!server || !token)
  && 'set JIRA_TEST_SERVER + JIRA_TEST_TOKEN (or provide .env.local) to run integration tests'

const CONFIG = skip ? null : { server: server.replace(/\/$/, ''), token }

test('myself: token works and identifies a user', { skip }, async () => {
  const me = await getMyself(CONFIG)
  assert.ok(me.displayName || me.name, 'expected a user identity in the response')
})

test(`search: project = ${PROJECT} returns a page`, { skip }, async () => {
  const page = await searchIssues(CONFIG, { jql: `project = ${PROJECT} ORDER BY created ASC`, maxResults: 5 })
  assert.ok(Array.isArray(page.issues))
  assert.ok(page.total >= page.issues.length)
})

test(`get_issue: ${ISSUE} has full detail fields`, { skip }, async () => {
  const issue = await getIssue(CONFIG, ISSUE)
  assert.equal(issue.key, ISSUE)
  assert.ok(issue.fields.summary)
  assert.ok(issue.fields.status?.name)
})
