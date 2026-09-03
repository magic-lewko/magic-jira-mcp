import { z } from 'zod'
import { JiraError } from '../jira-client.mjs'
import { consumeWriteBudget } from '../write-guard.mjs'
import {
  EPIC_LINK_FIELD, EPIC_NAME_FIELD, SPRINT_FIELD, STORY_POINTS_FIELD, resolveField,
} from '../issue-fields.mjs'
import { markdownToWiki } from '../wiki-markup.mjs'

/**
 * WRITE tool. Edits ONE existing issue, limited to a whitelist of fields.
 * Grew from production use ("assign a developer to an existing bug", the
 * hygiene loop closed by /sprint-health) and from the breakdown change
 * request: title typos, Story Points, sprint and epic moves, Epic Name.
 *
 * Deliberately NOT supported: status (use transition_issue) and parent — in
 * Jira Server a sub-task's parent is fixed at creation.
 */
export default {
  name: 'update_issue',
  config: {
    title: 'Update issue fields (WRITE)',
    description: 'Change fields of ONE existing issue: summary, assignee, labels, components, '
      + 'priority, description (Markdown → wiki markup), story_points, sprint_id, epic_key (Epic '
      + 'Link), epic_name. Show the user exactly what will change and get confirmation BEFORE '
      + 'calling. `labels` and `components` REPLACE the current lists — to add a label without '
      + 'losing the others use `add_labels`. To change status use transition_issue. Counts against '
      + 'the per-session write budget.',
    inputSchema: {
      key: z.string().describe('Issue key, e.g. "PROJ-42"'),
      summary: z.string().min(5).optional().describe('New title'),
      assignee: z.string().optional()
        .describe('Jira username to assign, or "unassigned" to clear the assignee'),
      labels: z.array(z.string()).optional().describe('REPLACES all labels'),
      add_labels: z.array(z.string()).optional().describe('Appends labels, keeping the existing ones'),
      components: z.array(z.string()).optional().describe('REPLACES all components (names)'),
      priority: z.string().optional().describe('Priority name, e.g. "High"'),
      description: z.string().optional()
        .describe('REPLACES the description (Markdown, converted to Jira wiki markup)'),
      description_format: z.enum(['markdown', 'wiki']).optional()
        .describe('Format of description; default "markdown"'),
      story_points: z.number().optional().describe('Story Points'),
      sprint_id: z.number().int().optional().describe('Sprint id to move the issue into'),
      epic_key: z.string().optional().describe('Epic to link the issue to (Epic Link)'),
      epic_name: z.string().optional().describe('Epic Name (epics only)'),
    },
  },

  /**
   * @param {object} args
   * @param {{config: object, client: object}} ctx
   * @returns {Promise<string>}
   */
  async run(args, { config, client }) {
    const issueKey = args.key.trim().toUpperCase()
    const project = issueKey.split('-')[0]

    const fields = {}
    const changed = []

    if (args.summary !== undefined) {
      fields.summary = args.summary.trim()
      changed.push(`summary → ${fields.summary}`)
    }
    if (args.assignee !== undefined) {
      const name = args.assignee.trim()
      const clearing = name === '' || name.toLowerCase() === 'unassigned'
      fields.assignee = { name: clearing ? null : name }
      changed.push(clearing ? 'assignee → (unassigned)' : `assignee → ${name}`)
    }
    if (args.labels) {
      fields.labels = args.labels
      changed.push(`labels → ${args.labels.join(', ') || '(empty)'}`)
    }
    if (args.add_labels?.length) {
      // Read-modify-write so adding never wipes labels the caller did not know about.
      const current = await client.getIssue(config, issueKey, { fields: ['labels'] })
      fields.labels = [...new Set([...(current.fields?.labels ?? []), ...(fields.labels ?? []), ...args.add_labels])]
      changed.push(`labels += ${args.add_labels.join(', ')}`)
    }
    if (args.components) {
      fields.components = args.components.map((name) => ({ name }))
      changed.push(`components → ${args.components.join(', ') || '(empty)'}`)
    }
    if (args.priority) {
      fields.priority = { name: args.priority }
      changed.push(`priority → ${args.priority}`)
    }
    if (args.description !== undefined) {
      fields.description = args.description_format === 'wiki' ? args.description : markdownToWiki(args.description)
      changed.push('description (replaced)')
    }
    if (args.story_points !== undefined) {
      fields[await resolveField(config, client, project, STORY_POINTS_FIELD)] = args.story_points
      changed.push(`story points → ${args.story_points}`)
    }
    if (args.sprint_id !== undefined) {
      fields[await resolveField(config, client, project, SPRINT_FIELD)] = args.sprint_id
      changed.push(`sprint → ${args.sprint_id}`)
    }
    if (args.epic_key) {
      const epicKey = args.epic_key.trim().toUpperCase()
      fields[await resolveField(config, client, project, EPIC_LINK_FIELD)] = epicKey
      changed.push(`epic → ${epicKey}`)
    }
    if (args.epic_name !== undefined) {
      const epicName = args.epic_name.trim()
      fields[await resolveField(config, client, project, EPIC_NAME_FIELD)] = epicName
      changed.push(`epic name → ${epicName}`)
    }

    if (Object.keys(fields).length === 0) {
      throw new JiraError(
        'No field to change was provided. Available: summary, assignee, labels, add_labels, components, '
        + 'priority, description, story_points, sprint_id, epic_key, epic_name.',
      )
    }

    consumeWriteBudget(config, 'write')
    await client.updateIssue(config, issueKey, fields)
    return `Updated ${issueKey}: ${changed.join(' · ')} — ${config.server}/browse/${issueKey}`
  },
}
