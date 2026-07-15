import { z } from 'zod'
import { JiraError } from '../jira-client.mjs'
import { getProjectProfile } from '../config.mjs'
import { consumeWriteBudget, findDuplicate } from '../write-guard.mjs'

/**
 * Resolve the Epic Link custom field id: project profile first, then
 * discovery via /rest/api/2/field. No caching — creates are rare and the
 * profile is the fast path.
 *
 * @param {object} config
 * @param {object} client
 * @param {string} project
 * @returns {Promise<string>}
 */
async function resolveEpicField(config, client, project) {
  const fromProfile = getProjectProfile(config, project).epicLinkField
  if (fromProfile) return fromProfile
  const fields = await client.listFields(config)
  const epicField = fields.find((f) => f.name === 'Epic Link')
    ?? fields.find((f) => f.schema?.custom?.endsWith(':gh-epic-link'))
  if (!epicField) {
    throw new JiraError('Nie wykryto pola Epic Link — uruchom /jira-tools:jira-config dla projektu albo pomiń epic_key.')
  }
  return epicField.id
}

/**
 * WRITE tool. Registered only behind JIRA_ALLOW_WRITE=true. Hard rails:
 * one issue per call, session budget, duplicate guard (SPEC §4.2).
 */
export default {
  name: 'create_issue',
  config: {
    title: 'Create issue (WRITE)',
    description: 'Create exactly ONE Jira issue and return its key + URL. '
      + 'NEVER call this in a loop — for a batch of tickets use the /jira-tools:create-task skill '
      + '(mandatory dry-run + user confirmation). Server-side rails: refuses when an open issue '
      + 'with the same summary exists (unless allow_duplicate=true) and enforces a per-session '
      + 'write budget.',
    inputSchema: {
      project: z.string().describe('Project key, e.g. "PROJ"'),
      issue_type: z.string().describe('Issue type name, e.g. "Task", "Bug", "Story"'),
      summary: z.string().min(5).describe('Issue title'),
      description: z.string().optional().describe('Issue description (Jira wiki markup or plain text)'),
      components: z.array(z.string()).optional().describe('Component names, e.g. ["iOS"]'),
      labels: z.array(z.string()).optional(),
      assignee: z.string().optional().describe('Jira username to assign'),
      epic_key: z.string().optional().describe('Epic to link the issue to'),
      allow_duplicate: z.boolean().optional()
        .describe('Set true ONLY when the user explicitly confirmed creating a near-duplicate'),
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

    if (!args.allow_duplicate) {
      const duplicate = await findDuplicate(config, client, project, summary)
      if (duplicate) {
        throw new JiraError(
          `Nie utworzono — w projekcie ${project} istnieje już otwarte zadanie o tym tytule: `
          + `${duplicate.key} („${duplicate.fields?.summary}", status: ${duplicate.fields?.status?.name ?? '?'}). `
          + 'Jeśli duplikat jest zamierzony i potwierdzony przez użytkownika, wywołaj ponownie z allow_duplicate=true.',
        )
      }
    }

    const fields = {
      project: { key: project },
      issuetype: { name: args.issue_type.trim() },
      summary,
    }
    if (args.description) fields.description = args.description
    if (args.components?.length) fields.components = args.components.map((name) => ({ name }))
    if (args.labels?.length) fields.labels = args.labels
    if (args.assignee) fields.assignee = { name: args.assignee }
    if (args.epic_key) {
      const epicField = await resolveEpicField(config, client, project)
      fields[epicField] = args.epic_key.trim().toUpperCase()
    }

    consumeWriteBudget(config, 'create')
    const created = await client.createIssue(config, fields)
    return `Utworzono ${created.key} — ${config.server}/browse/${created.key}`
  },
}
