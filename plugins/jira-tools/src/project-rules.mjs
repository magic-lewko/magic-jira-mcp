/**
 * @fileoverview Shared project rules (SPEC §5.2): team conventions stored IN
 * JIRA as a project property, so everyone who works on the project gets the
 * same behaviour without editing a local config. Today one rule kind:
 * "assignee → component" (e.g. bugs assigned to a frontend developer get the
 * Frontend component). The write tools apply it in code.
 */

import { z } from 'zod'
import { debug } from './jira-client.mjs'

/** Key of the project property that holds the rules. */
export const RULES_PROPERTY = 'jira-tools'

/** One stored rule: these assignees get this component (optionally for some issue types only). */
const COMPONENT_RULE = z.object({
  component: z.string().min(1),
  assignees: z.array(z.string().min(1)).min(1),
  issueTypes: z.array(z.string().min(1)).optional(),
})

/** The whole property value; unknown keys are kept for later rule kinds. */
const RULES_VALUE = z.object({
  componentRules: z.array(COMPONENT_RULE).optional(),
  updatedBy: z.string().optional(),
  updatedAt: z.string().optional(),
}).passthrough()

/**
 * Read the shared rules of a project. No property means no rules. A value
 * that does not match the schema is never applied half-way: it is ignored
 * and reported in `warning`.
 *
 * @param {object} config
 * @param {object} client
 * @param {string} project
 * @returns {Promise<{value: object, componentRules: object[], warning?: string}>}
 */
export async function loadProjectRules(config, client, project) {
  const raw = await client.getProjectProperty(config, project, RULES_PROPERTY)
  if (raw === null || raw === undefined) return { value: {}, componentRules: [] }
  const parsed = RULES_VALUE.safeParse(raw)
  if (!parsed.success) {
    return {
      value: {},
      componentRules: [],
      warning: `The shared rules of ${project} are not valid, so none was applied. Save them again with set_project_rules.`,
    }
  }
  return { value: parsed.data, componentRules: parsed.data.componentRules ?? [] }
}

/**
 * loadProjectRules for the write tools: a read failure never blocks a write.
 * It comes back as a warning that the tool shows next to its result.
 *
 * @param {object} config
 * @param {object} client
 * @param {string} project
 * @returns {Promise<{componentRules: object[], warning?: string}>}
 */
export async function loadRulesForWrite(config, client, project) {
  try {
    return await loadProjectRules(config, client, project)
  } catch (err) {
    debug('project rules unavailable:', err?.message)
    return {
      componentRules: [],
      warning: `The shared rules of ${project} could not be read (${err?.message ?? err}), so no rule component was added.`,
    }
  }
}

/**
 * Components the rules give one assignee on one issue type (case-insensitive,
 * in rule order, without repeats).
 *
 * @param {object[]} componentRules
 * @param {{assignee?: string, issueType?: string}} target
 * @returns {string[]}
 */
export function componentsForAssignee(componentRules, { assignee, issueType }) {
  const who = String(assignee ?? '').trim().toLowerCase()
  if (!who) return []
  const type = String(issueType ?? '').trim().toLowerCase()
  const out = []
  for (const rule of componentRules ?? []) {
    if (!rule.assignees.some((name) => name.toLowerCase() === who)) continue
    if (rule.issueTypes?.length && !rule.issueTypes.some((t) => t.toLowerCase() === type)) continue
    if (!out.some((c) => c.toLowerCase() === rule.component.toLowerCase())) out.push(rule.component)
  }
  return out
}

/**
 * Add rule components to a component list. Rules only add: a component that
 * is already there (in any case) stays as it is, and nothing is removed.
 *
 * @param {string[]} current
 * @param {string[]} extra
 * @returns {{list: string[], added: string[]}}
 */
export function mergeComponents(current, extra) {
  const list = [...current]
  const added = []
  for (const name of extra) {
    if (list.some((c) => c.toLowerCase() === name.toLowerCase())) continue
    list.push(name)
    added.push(name)
  }
  return { list, added }
}

/**
 * One readable line per rule, e.g. "- Bug → Frontend: user.a, user.b".
 *
 * @param {object[]} componentRules
 * @param {Map<string, string>} [displayNames] - username → display name
 * @returns {string[]}
 */
export function formatComponentRules(componentRules, displayNames = new Map()) {
  return componentRules.map((rule) => {
    const who = rule.assignees.map((name) => (displayNames.has(name) ? `${name} (${displayNames.get(name)})` : name))
    const types = rule.issueTypes?.length ? rule.issueTypes.join(', ') : 'Any type'
    return `- ${types} → ${rule.component}: ${who.join(', ')}`
  })
}
