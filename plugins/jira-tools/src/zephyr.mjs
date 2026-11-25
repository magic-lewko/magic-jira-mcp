/**
 * @fileoverview Shared Zephyr Squad Server logic (SPEC §4.6): project and
 * version resolution, the Zephyr "Test" issue type, cycle-response
 * flattening, execution-status matching and the step input schema — used by
 * the Zephyr read and write tools.
 */

import { z } from 'zod'
import { JiraError } from './jira-client.mjs'

/** AI transparency suffix, the same text add_comment appends. */
export const AI_SIGNATURE = '_(ai-generated · jira-tools)_'

/** Steps per test in one call. */
export const MAX_STEPS = 30

/** Zephyr's built-in "Unscheduled" version. */
export const UNSCHEDULED = { id: -1, name: 'Unscheduled' }

/** One test step: action, test data, expected result. */
export const TEST_STEP_INPUT = z.object({
  step: z.string().min(1).describe('Action, e.g. "Tap Log in"'),
  data: z.string().optional().describe('Test data, e.g. "user: demo@example.com"'),
  result: z.string().optional().describe('Expected result, e.g. "The dashboard opens"'),
})

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * Whether a Jira issue type is the Zephyr test type: named "Test", or
 * described by the Zephyr plugin (localised instances keep the description).
 *
 * @param {{name?: string, description?: string, subtask?: boolean}|undefined} type
 * @returns {boolean}
 */
export function isZephyrTestType(type) {
  if (!type || type.subtask) return false
  return String(type.name ?? '').trim().toLowerCase() === 'test' || /zephyr/i.test(String(type.description ?? ''))
}

/**
 * Project id, key and the Zephyr test type name. Throws when the project has
 * no Zephyr test type (Zephyr not enabled for it).
 *
 * @param {object} config
 * @param {object} client
 * @param {string} projectKey
 * @param {{requireTestType?: boolean}} [opts]
 * @returns {Promise<{id: string, key: string, testType: string|null}>}
 */
export async function resolveZephyrProject(config, client, projectKey, { requireTestType = false } = {}) {
  const key = projectKey.trim().toUpperCase()
  const project = await client.getProject(config, key)
  const types = project?.issueTypes ?? []
  const testType = types.find((t) => !t.subtask && String(t.name).trim().toLowerCase() === 'test')
    ?? types.find(isZephyrTestType)
  if (requireTestType && !testType) {
    throw new JiraError(
      `Project ${key} has no Zephyr "Test" issue type, so Zephyr is not enabled for it. `
      + `Issue types: ${types.map((t) => t.name).join(', ') || '(none)'}.`,
    )
  }
  return { id: String(project.id), key, testType: testType?.name ?? null }
}

/**
 * Resolve a version name to its id. No name, or "Unscheduled" → -1.
 *
 * @param {object} config
 * @param {object} client
 * @param {string} projectKey
 * @param {string|undefined} name
 * @returns {Promise<{id: number, name: string}>}
 */
export async function resolveVersion(config, client, projectKey, name) {
  const wanted = String(name ?? '').trim().toLowerCase()
  if (!wanted || wanted === 'unscheduled') return UNSCHEDULED
  const versions = await client.listProjectVersions(config, projectKey)
  const hit = versions.find((v) => String(v.name).trim().toLowerCase() === wanted)
  if (!hit) {
    const open = versions.filter((v) => !v.archived && !v.released).map((v) => v.name)
    throw new JiraError(
      `Version not found in ${projectKey}: "${name}". Unreleased versions: ${open.slice(-20).join(', ') || '(none)'}. `
      + 'Omit the version for "Unscheduled".',
    )
  }
  return { id: Number(hit.id), name: hit.name }
}

/**
 * Flatten Zephyr's cycle listing — either `{cycleId: cycle, recordsCount}`
 * (one version) or `{versionId: [{cycleId: cycle, recordsCount}]}` (all
 * versions) — into cycles with a numeric `id`, newest first. Empty "Ad hoc"
 * cycles are dropped.
 *
 * @param {object} raw
 * @returns {object[]}
 */
export function cyclesFromResponse(raw) {
  const out = []
  const collect = (map) => {
    for (const [id, cycle] of Object.entries(map ?? {})) {
      if (id === 'recordsCount' || !cycle || typeof cycle !== 'object' || Array.isArray(cycle)) continue
      out.push({ ...cycle, id: Number(id) })
    }
  }
  for (const value of Object.values(raw ?? {})) {
    if (Array.isArray(value)) value.forEach(collect)
  }
  if (out.length === 0) collect(raw)
  return out
    .filter((c) => !(c.id === -1 && !c.totalExecutions && !c.totalFolders))
    .sort((a, b) => b.id - a.id)
}

/**
 * Match a status by name (case-insensitive) or id against the instance list.
 *
 * @param {{id: number, name: string}[]} statuses
 * @param {string} requested
 * @returns {{id: number, name: string}}
 */
export function resolveExecutionStatus(statuses, requested) {
  const wanted = String(requested).trim().toLowerCase()
  const hit = statuses.find((s) => String(s.name).toLowerCase() === wanted) ?? statuses.find((s) => String(s.id) === wanted)
  if (!hit) {
    throw new JiraError(`Unknown execution status "${requested}". Available: ${statuses.map((s) => s.name).join(', ')}.`)
  }
  return hit
}

/**
 * "YYYY-MM-DD" → Zephyr's date-picker format "d/MMM/yy" (e.g. "1/Dec/26").
 *
 * @param {string} iso
 * @param {string} label - parameter name for the error message
 * @returns {string}
 */
export function toZephyrDate(iso, label) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso).trim())
  const date = match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null
  if (!date || date.getUTCDate() !== Number(match[3])) {
    throw new JiraError(`${label} must be a date in the form YYYY-MM-DD, e.g. "2026-12-01".`)
  }
  return `${date.getUTCDate()}/${MONTHS[date.getUTCMonth()]}/${String(date.getUTCFullYear()).slice(2)}`
}

/**
 * Add steps to one test, in order, consuming the write budget per step. Stops
 * at the first failing step and reports how far it got.
 *
 * @param {object} config
 * @param {object} client
 * @param {number|string} issueId
 * @param {{step: string, data?: string, result?: string}[]} steps
 * @param {(config: object, kind: 'write') => void} consume - consumeWriteBudget
 * @returns {Promise<{added: number, error?: string}>}
 */
export async function addSteps(config, client, issueId, steps, consume) {
  let added = 0
  for (const step of steps) {
    try {
      consume(config, 'write')
      await client.addTestStep(config, issueId, { step: step.step.trim(), data: step.data ?? '', result: step.result ?? '' })
      added += 1
    } catch (err) {
      return { added, error: err?.message ?? String(err) }
    }
  }
  return { added }
}
