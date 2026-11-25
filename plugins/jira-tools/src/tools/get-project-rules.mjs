import { z } from 'zod'
import { RULES_PROPERTY, formatComponentRules, loadProjectRules } from '../project-rules.mjs'

/** The shared rules of a project, stored in Jira (SPEC §5.2). */
export default {
  name: 'get_project_rules',
  config: {
    title: 'Get shared project rules',
    description: 'Show the rules a project shares with everyone who uses jira-tools on it. They are '
      + `stored in Jira itself (project property "${RULES_PROPERTY}"), not in a local config. Today: `
      + '"assignee → component" — create_issue, create_issues, create_test_cases and update_issue '
      + '(assignee change) add the component in code when the assignee and the issue type match. '
      + 'Call it before a create preview to show the component a rule will add. Change the rules '
      + 'with set_project_rules.',
    inputSchema: {
      project: z.string().describe('Project key, e.g. "PROJ"'),
    },
  },

  /**
   * @param {{project: string}} args
   * @param {{config: object, client: object}} ctx
   * @returns {Promise<string>}
   */
  async run({ project }, { config, client }) {
    const key = project.trim().toUpperCase()
    const rules = await loadProjectRules(config, client, key)
    if (rules.warning) return rules.warning
    if (!rules.componentRules.length) {
      return `No shared rules in ${key}. Set them with set_project_rules (needs the Administer Projects permission).`
    }
    const { updatedBy, updatedAt } = rules.value
    return [
      `Shared rules of ${key} (stored in Jira, used by everyone who works on ${key} with jira-tools):`,
      'Component by assignee (issue type → component: assignees):',
      ...formatComponentRules(rules.componentRules),
      ...(updatedBy || updatedAt ? [`Last change: ${updatedBy ?? '?'}, ${updatedAt?.slice(0, 10) ?? '?'}`] : []),
      'Only jira-tools applies them. An assignment made by hand in Jira adds no component.',
    ].join('\n')
  },
}
