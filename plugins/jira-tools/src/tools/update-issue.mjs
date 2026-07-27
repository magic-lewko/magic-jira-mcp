import { z } from 'zod'
import { JiraError } from '../jira-client.mjs'
import { assertProjectWritable, consumeWriteBudget } from '../write-guard.mjs'

/**
 * WRITE tool. Registered only behind JIRA_ALLOW_WRITE=true.
 *
 * Edits ONE existing issue, limited to a whitelist of safe fields — reported
 * from production use ("assign a developer to an existing bug") and closing the
 * hygiene loop: /sprint-health finds issues without description/labels/component,
 * this fixes them.
 *
 * Deliberately NOT supported: summary (renaming interacts badly with the
 * duplicate guard), status (use transition_issue), epic (use assign_to_epic).
 */
export default {
  name: 'update_issue',
  config: {
    title: 'Update issue fields (WRITE)',
    description: 'Change fields of ONE existing issue: assignee, labels, components, '
      + 'priority, description. Show the user exactly what will change and get confirmation '
      + 'BEFORE calling. Note: `labels` and `components` REPLACE the current lists — to add '
      + 'a label without losing the others use `add_labels`. To change status use '
      + 'transition_issue, to link an epic use assign_to_epic. Counts against the '
      + 'per-session write budget.',
    inputSchema: {
      key: z.string().describe('Issue key, e.g. "PROJ-42"'),
      assignee: z.string().optional()
        .describe('Jira username to assign, or "unassigned" to clear the assignee'),
      labels: z.array(z.string()).optional().describe('REPLACES all labels'),
      add_labels: z.array(z.string()).optional().describe('Appends labels, keeping the existing ones'),
      components: z.array(z.string()).optional().describe('REPLACES all components (names)'),
      priority: z.string().optional().describe('Priority name, e.g. "High"'),
      description: z.string().optional().describe('REPLACES the description'),
    },
  },

  /**
   * @param {object} args
   * @param {{config: object, client: object}} ctx
   * @returns {Promise<string>}
   */
  async run(args, { config, client }) {
    const issueKey = args.key.trim().toUpperCase()
    assertProjectWritable(config, issueKey.split('-')[0])

    const fields = {}
    const changed = []

    if (args.assignee !== undefined) {
      const name = args.assignee.trim()
      const clearing = name === '' || name.toLowerCase() === 'unassigned'
      fields.assignee = { name: clearing ? null : name }
      changed.push(clearing ? 'assignee → (nieprzypisany)' : `assignee → ${name}`)
    }
    if (args.labels) {
      fields.labels = args.labels
      changed.push(`labels → ${args.labels.join(', ') || '(puste)'}`)
    }
    if (args.add_labels?.length) {
      // Read-modify-write so adding never wipes labels the caller did not know about.
      const current = await client.getIssue(config, issueKey, { fields: ['labels'] })
      const merged = [...new Set([...(current.fields?.labels ?? []), ...(fields.labels ?? []), ...args.add_labels])]
      fields.labels = merged
      changed.push(`labels += ${args.add_labels.join(', ')}`)
    }
    if (args.components) {
      fields.components = args.components.map((name) => ({ name }))
      changed.push(`komponenty → ${args.components.join(', ') || '(puste)'}`)
    }
    if (args.priority) {
      fields.priority = { name: args.priority }
      changed.push(`priorytet → ${args.priority}`)
    }
    if (args.description !== undefined) {
      fields.description = args.description
      changed.push('opis (zastąpiony)')
    }

    if (Object.keys(fields).length === 0) {
      throw new JiraError(
        'Nie podano żadnego pola do zmiany. Dostępne: assignee, labels, add_labels, components, priority, description.',
      )
    }

    consumeWriteBudget(config, 'write')
    await client.updateIssue(config, issueKey, fields)
    return `Zaktualizowano ${issueKey}: ${changed.join(' · ')} — ${config.server}/browse/${issueKey}`
  },
}
