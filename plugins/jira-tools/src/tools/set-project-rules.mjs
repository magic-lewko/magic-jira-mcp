import { z } from 'zod'
import { JiraError } from '../jira-client.mjs'
import { assertWriteBudget, consumeWriteBudget } from '../write-guard.mjs'
import { resolveIssueType } from '../issue-fields.mjs'
import { RULES_PROPERTY, formatComponentRules, loadProjectRules } from '../project-rules.mjs'

/** Rules per project, and people per rule. */
const MAX_RULES = 30
const MAX_ASSIGNEES = 30

/**
 * Find ONE active user for a username or a name. An exact username wins;
 * otherwise the search must give exactly one person.
 *
 * @param {object} config
 * @param {object} client
 * @param {string} text
 * @param {Map<string, object>} cache - lower-case text → result
 * @returns {Promise<{name: string, displayName: string}|{error: string}>}
 */
async function resolveUser(config, client, text, cache) {
  const q = text.trim()
  const cacheKey = q.toLowerCase()
  if (cache.has(cacheKey)) return cache.get(cacheKey)
  const hits = await client.findUsers(config, q) ?? []
  const exact = hits.find((u) => String(u.name).toLowerCase() === cacheKey)
  let result
  if (exact) result = exact
  else if (hits.length === 1) result = hits[0]
  else if (!hits.length) result = { error: `no active Jira user matches "${q}"` }
  else {
    const names = hits.slice(0, 5).map((u) => `${u.name} (${u.displayName})`).join(', ')
    result = { error: `"${q}" matches ${hits.length} users: ${names} — use the username` }
  }
  cache.set(cacheKey, result)
  return result
}

/**
 * WRITE tool. Replaces the "assignee → component" rules of a project, stored
 * in Jira as a project property (SPEC §5.2). Every component, issue type and
 * person is checked first; one problem means nothing is saved.
 */
export default {
  name: 'set_project_rules',
  config: {
    title: 'Set shared project rules (WRITE)',
    description: 'Save the "assignee → component" rules of a project in Jira (project property '
      + `"${RULES_PROPERTY}"), shared by everyone who uses jira-tools on it. Example: "if a bug is `
      + 'assigned to Nowak or jkowalski, add the Frontend component". The call REPLACES all component '
      + 'rules of the project: read the current ones with get_project_rules, merge the change, and '
      + 'pass the full list (an empty list clears them). People may be usernames or names; each must '
      + 'match exactly one active user. Components and issue types (roles bug/story/task/epic/subtask '
      + 'or exact names) must exist in the project. One problem → nothing is saved. Call first with '
      + 'dry_run=true for the preview, then without it after the user confirms. Needs the Administer '
      + 'Projects permission. Counts against the per-session write budget.',
    inputSchema: {
      project: z.string().describe('Project key, e.g. "PROJ"'),
      component_rules: z.array(z.object({
        component: z.string().min(1).describe('Component name, e.g. "Frontend"'),
        assignees: z.array(z.string().min(1)).min(1).max(MAX_ASSIGNEES)
          .describe('Usernames or names, e.g. ["jkowalski", "Nowak"]'),
        issue_types: z.array(z.string().min(1)).optional()
          .describe('Issue types the rule applies to, e.g. ["bug"]; omit for all types'),
      })).max(MAX_RULES).describe(`The full list of component rules (max ${MAX_RULES})`),
      dry_run: z.boolean().optional().describe('true = check and show the result, save nothing'),
    },
  },

  /**
   * @param {{project: string, component_rules: object[], dry_run?: boolean}} args
   * @param {{config: object, client: object}} ctx
   * @returns {Promise<string>}
   */
  async run({ project, component_rules, dry_run }, { config, client }) {
    const key = project.trim().toUpperCase()
    if (!dry_run) assertWriteBudget(config, 'write', 1)

    const proj = await client.getProject(config, key)
    const componentNames = (proj?.components ?? []).map((c) => String(c.name))
    const projectTypes = (proj?.issueTypes ?? []).map((t) => ({ name: String(t.name), subtask: Boolean(t.subtask) }))

    const userCache = new Map()
    const displayNames = new Map()
    const problems = []
    const rules = []
    for (const [index, rule] of component_rules.entries()) {
      const label = `rule ${index + 1}`
      const component = componentNames.find((c) => c.toLowerCase() === rule.component.trim().toLowerCase())
      if (!component) {
        problems.push(`${label}: ${key} has no component "${rule.component}". Components: ${componentNames.join(', ') || 'none'}.`)
      }
      const issueTypes = []
      for (const requested of rule.issue_types ?? []) {
        const type = resolveIssueType(config, key, projectTypes, requested)
        if (!type) {
          problems.push(`${label}: ${key} has no issue type "${requested}". Types: ${projectTypes.map((t) => t.name).join(', ') || 'none'}.`)
        } else if (!issueTypes.includes(type.name)) {
          issueTypes.push(type.name)
        }
      }
      const assignees = []
      for (const who of rule.assignees) {
        const user = await resolveUser(config, client, who, userCache)
        if ('error' in user) {
          problems.push(`${label}: ${user.error}`)
          continue
        }
        if (!assignees.includes(user.name)) assignees.push(user.name)
        displayNames.set(user.name, user.displayName)
      }
      if (component) rules.push({ component, assignees, ...(issueTypes.length ? { issueTypes } : {}) })
    }
    if (problems.length) {
      throw new JiraError(['Nothing saved:', ...problems.map((p) => `- ${p}`)].join('\n'))
    }

    const lines = rules.length ? formatComponentRules(rules, displayNames) : ['(no rules — this clears them)']
    if (dry_run) {
      return [
        `Preview, nothing saved. The component rules of ${key} would be (issue type → component: assignees):`,
        ...lines,
        `Saving replaces all component rules of ${key}.`,
      ].join('\n')
    }

    const current = await loadProjectRules(config, client, key)
    const me = await client.getMyself(config)
    const value = {
      ...current.value,
      componentRules: rules,
      updatedBy: me?.name ?? '?',
      updatedAt: new Date().toISOString(),
    }
    consumeWriteBudget(config, 'write')
    try {
      await client.setProjectProperty(config, key, RULES_PROPERTY, value)
    } catch (err) {
      if (err instanceof JiraError && err.status === 403) {
        throw new JiraError(
          `Not saved — changing the rules of ${key} needs the Administer Projects permission. `
          + 'Ask a project admin to save them or to give you the permission.',
        )
      }
      throw err
    }
    return [
      `Saved ${rules.length} component rule(s) for ${key} in Jira. Everyone who works on ${key} with jira-tools gets them:`,
      ...lines,
      'They apply when jira-tools creates an issue or changes its assignee. An assignment made by hand in Jira adds no component.',
    ].join('\n')
  },
}
