import { z } from 'zod'
import { JiraError } from '../jira-client.mjs'
import { consumeWriteBudget, findDuplicate } from '../write-guard.mjs'
import { ISSUE_ITEM_INPUT, buildIssueFields, createRailError, loadProjectTypes } from '../issue-fields.mjs'
import { loadRulesForWrite } from '../project-rules.mjs'

/**
 * WRITE tool. Creates exactly ONE issue. Hard rails: session budget,
 * duplicate guard (scoped to the parent for sub-tasks), one issue per call,
 * the user's sprint choice and the standard bug template (SPEC §4.2). All field rules live in issue-fields.mjs and are shared with
 * create_issues, so a single create and a bulk create behave identically.
 */
export default {
  name: 'create_issue',
  config: {
    title: 'Create issue (WRITE)',
    description: 'Create exactly ONE Jira issue and return its key + URL. Supports epics (epic_name, '
      + 'defaults to the summary), sub-tasks (parent) and role-based issue types '
      + '(epic/story/task/subtask/bug resolved to the project\'s own type names). Descriptions are '
      + 'Markdown, converted to Jira wiki markup. For a whole breakdown use create_issues (up to 50 '
      + 'in one call) — but ALWAYS after the /jira-tools:create-task dry-run and the user\'s '
      + 'confirmation. Server-side rails: refuses when an open issue with the same summary exists '
      + '(same parent for sub-tasks) unless allow_duplicate=true, and enforces a per-session write '
      + 'budget. Ask the user first: active sprint or backlog. sprint_id or backlog=true is '
      + 'required, except for epics and sub-tasks. A bug uses the standard template: summary '
      + '"[label] title" plus steps_to_reproduce, actual_result and expected_result (the server '
      + 'writes the description). With an assignee, the project\'s shared rules (get_project_rules) '
      + 'add the assignee\'s component in code.',
    inputSchema: {
      project: z.string().describe('Project key, e.g. "PROJ"'),
      ...ISSUE_ITEM_INPUT,
    },
  },

  /**
   * @param {object} args
   * @param {{config: object, client: object}} ctx
   * @returns {Promise<string>}
   */
  async run(args, { config, client }) {
    const project = args.project.trim().toUpperCase()
    const summary = args.summary.trim()
    const parentKey = args.parent?.trim().toUpperCase()

    const projectTypes = await loadProjectTypes(config, client, project)
    const refusal = createRailError(args, { config, project, projectTypes })
    if (refusal) throw new JiraError(`Not created — ${refusal}`)

    if (!args.allow_duplicate) {
      const duplicate = await findDuplicate(config, client, project, summary, { parent: parentKey })
      if (duplicate) {
        const where = parentKey ? `${parentKey} already has` : `project ${project} already has`
        throw new JiraError(
          `Not created — ${where} an open issue with this title: `
          + `${duplicate.key} („${duplicate.fields?.summary}", status: ${duplicate.fields?.status?.name ?? '?'}). `
          + 'If the duplicate is intended and the user confirmed it, call again with allow_duplicate=true.',
        )
      }
    }

    const rules = args.assignee ? await loadRulesForWrite(config, client, project) : { componentRules: [] }
    const { fields, ruleComponents } = await buildIssueFields(args, {
      config, client, project, projectTypes, componentRules: rules.componentRules,
    })

    consumeWriteBudget(config, 'create')
    const created = await client.createIssue(config, fields)
    const ruleNote = ruleComponents.length ? ` · component ${ruleComponents.join(', ')} added by the project rule` : ''
    return [`Created ${created.key} — ${config.server}/browse/${created.key}${ruleNote}`, rules.warning]
      .filter(Boolean).join('\n')
  },
}
