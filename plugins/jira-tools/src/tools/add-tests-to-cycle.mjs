import { z } from 'zod'
import { JiraError, expandKeys } from '../jira-client.mjs'
import { assertWriteBudget, consumeWriteBudget } from '../write-guard.mjs'
import { isZephyrTestType } from '../zephyr.mjs'

/** Tests per call (after range expansion). */
const MAX_KEYS = 50

/** Parallel issue lookups. */
const LOOKUP_CHUNK = 10

/** Executions read to find tests already in the cycle. */
const EXISTING_LIMIT = 2000

/**
 * Fetch issues one by one (a JQL `key in (...)` fails on the first unknown key),
 * in small parallel chunks. Missing keys come back as null.
 *
 * @param {object} config
 * @param {object} client
 * @param {string[]} keys
 * @returns {Promise<Map<string, object|null>>}
 */
async function lookupIssues(config, client, keys) {
  const found = new Map()
  for (let i = 0; i < keys.length; i += LOOKUP_CHUNK) {
    const chunk = keys.slice(i, i + LOOKUP_CHUNK)
    const issues = await Promise.all(chunk.map((key) => client
      .getIssue(config, key, { fields: ['issuetype', 'summary', 'project'] })
      .catch((err) => (err?.status === 404 ? null : Promise.reject(err)))))
    chunk.forEach((key, n) => found.set(key, issues[n]))
  }
  return found
}

/**
 * WRITE tool. Puts Zephyr tests into a cycle (optionally a folder) as new
 * executions, one synchronous request per test. Validates every key first —
 * nothing is added when any key is unknown, not a test or from another
 * project. Tests already in the same cycle/folder are skipped, not duplicated.
 */
export default {
  name: 'add_tests_to_cycle',
  config: {
    title: 'Add tests to a Zephyr cycle (WRITE)',
    description: `Add up to ${MAX_KEYS} Zephyr tests (keys or ranges like "PROJ-98..111") to ONE test cycle, `
      + 'optionally into one of its folders (folder ids: list_test_cycles with cycle_id). Each test becomes '
      + 'an UNEXECUTED execution; the returned execution ids are what set_execution_status needs. Nothing '
      + 'is added when a key is unknown, not a Zephyr test, or from another project. Tests already in the '
      + 'cycle (same folder) are skipped. Each added test counts against the per-session write budget.',
    inputSchema: {
      cycle_id: z.number().int().describe('Cycle id (from list_test_cycles or create_test_cycle)'),
      keys: z.array(z.string()).min(1).describe('Test keys or ranges, e.g. ["PROJ-30", "PROJ-41..45"]'),
      folder_id: z.number().int().optional().describe('Folder id inside the cycle; omit for the cycle root'),
    },
  },

  /**
   * @param {{cycle_id: number, keys: string[], folder_id?: number}} args
   * @param {{config: object, client: object}} ctx
   * @returns {Promise<string>}
   */
  async run({ cycle_id, keys, folder_id }, { config, client }) {
    const wanted = expandKeys(keys)
    if (wanted.length > MAX_KEYS) {
      throw new JiraError(`Too many tests (${wanted.length}). Add at most ${MAX_KEYS} per call.`)
    }

    const cycle = await client.getTestCycle(config, cycle_id)
    const scope = { projectId: cycle.projectId, versionId: cycle.versionId }
    let where = `cycle "${cycle.name}" (id ${cycle_id})`
    if (folder_id !== undefined) {
      const folders = await client.listCycleFolders(config, cycle_id, scope)
      const folder = folders.find((f) => Number(f.folderId) === folder_id)
      if (!folder) {
        const list = folders.map((f) => `#${f.folderId} ${f.folderName}`).join(', ') || '(none)'
        throw new JiraError(`Folder ${folder_id} is not in cycle ${cycle_id}. Folders: ${list}.`)
      }
      where += ` / folder "${folder.folderName}"`
    }

    const issues = await lookupIssues(config, client, wanted)
    const missing = wanted.filter((key) => !issues.get(key))
    const notTests = wanted.filter((key) => issues.get(key) && !isZephyrTestType(issues.get(key).fields?.issuetype))
    const otherProject = wanted.filter((key) => issues.get(key)
      && String(issues.get(key).fields?.project?.id) !== String(cycle.projectId))
    if (missing.length || notTests.length || otherProject.length) {
      const problems = []
      if (missing.length) problems.push(`not found: ${missing.join(', ')}`)
      if (notTests.length) problems.push(`not Zephyr tests: ${notTests.join(', ')}`)
      if (otherProject.length) problems.push(`from another project than the cycle: ${otherProject.join(', ')}`)
      throw new JiraError(`Nothing added — ${problems.join('; ')}.`)
    }

    const existing = await client.searchExecutions(config, { zql: `cycleId = ${cycle_id}`, limit: EXISTING_LIMIT })
    const inScope = new Map(existing.executions
      .filter((e) => (folder_id === undefined ? e.folderId === undefined || e.folderId === null : Number(e.folderId) === folder_id))
      .map((e) => [String(e.issueKey).toUpperCase(), e.id]))
    const toAdd = wanted.filter((key) => !inScope.has(key))
    assertWriteBudget(config, 'write', toAdd.length)

    const lines = []
    let added = 0
    for (const key of toAdd) {
      try {
        consumeWriteBudget(config, 'write')
        const execution = await client.createExecution(config, {
          issueId: issues.get(key).id, cycleId: cycle_id, ...scope, folderId: folder_id,
        })
        added += 1
        lines.push(`- ${key} → execution #${execution?.id ?? '?'}`)
      } catch (err) {
        lines.push(`- ${key}: FAILED — ${err?.message ?? err}`)
      }
    }
    const skipped = wanted.filter((key) => inScope.has(key))
    const out = [`Added ${added}/${toAdd.length} tests to ${where}:`, ...lines]
    if (toAdd.length === 0) out[0] = `Nothing to add — every test is already in ${where}.`
    if (skipped.length) {
      out.push(`Already in the cycle (skipped): ${skipped.map((key) => `${key} (#${inScope.get(key)})`).join(', ')}`)
    }
    return out.join('\n')
  },
}
