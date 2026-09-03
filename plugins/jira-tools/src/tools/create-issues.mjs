import { z } from 'zod'
import { JiraError } from '../jira-client.mjs'
import { assertWriteBudget, consumeWriteBudget, findDuplicate } from '../write-guard.mjs'
import { ISSUE_ITEM_INPUT, buildIssueFields, loadProjectTypes } from '../issue-fields.mjs'

/** Jira Server's default cap for /rest/api/2/issue/bulk. */
const MAX_ITEMS = 50

/**
 * @param {string} s
 * @returns {string}
 */
function normalize(s) {
  return String(s ?? '').toLowerCase().replaceAll(/\s+/g, ' ').trim()
}

/**
 * Turn one bulk error into a readable line.
 *
 * @param {object} error - Jira bulk error entry
 * @returns {string}
 */
function describeError(error) {
  const parts = [
    ...(error.elementErrors?.errorMessages ?? []),
    ...Object.entries(error.elementErrors?.errors ?? {}).map(([field, message]) => `${field}: ${message}`),
  ]
  return parts.join('; ') || `HTTP ${error.status ?? '?'}`
}

/**
 * WRITE tool. Creates up to MAX_ITEMS issues in one request — the sanctioned
 * path for a whole breakdown (epic + stories + sub-tasks) instead of a loop of
 * create_issue calls (SPEC §4.2). Same per-item rules as create_issue via the
 * shared builder. Blast radius is kept proportionate by: the whole batch must
 * fit the session budget or nothing is created, every item passes the
 * duplicate guard (Jira + within the batch), and the skills' mandatory dry-run.
 */
export default {
  name: 'create_issues',
  config: {
    title: 'Create issues in bulk (WRITE)',
    description: `Create up to ${MAX_ITEMS} issues in ONE call (POST /rest/api/2/issue/bulk) — the `
      + 'sanctioned way to create a whole breakdown. Call it ONLY after the /jira-tools:create-task '
      + 'dry-run and the user\'s explicit confirmation. Jira assigns keys on creation, so a parent or '
      + 'epic created in this call cannot be referenced by the same call: create the epic and the '
      + 'stories first, then the sub-tasks in a second call with parent set. Each item follows the '
      + 'create_issue rules (roles, epic_name, parent validation, Markdown → wiki, ai-generated '
      + 'label). The whole batch must fit the session write budget or nothing is created; each '
      + 'item passes the duplicate guard. Returns the created keys and per-item errors.',
    inputSchema: {
      project: z.string().describe('Project key, e.g. "PROJ"'),
      items: z.array(z.object(ISSUE_ITEM_INPUT)).min(1).max(MAX_ITEMS)
        .describe(`Issues to create, in order (max ${MAX_ITEMS})`),
    },
  },

  /**
   * @param {{project: string, items: object[]}} args
   * @param {{config: object, client: object}} ctx
   * @returns {Promise<string>}
   */
  async run(args, { config, client }) {
    const project = args.project.trim().toUpperCase()
    const { items } = args

    // All-or-nothing on the budget: refuse before any HTTP when the batch does not fit.
    assertWriteBudget(config, 'create', items.length)

    const projectTypes = await loadProjectTypes(config, client, project)
    const seen = new Set()
    const payload = []
    for (const [index, item] of items.entries()) {
      const summary = item.summary.trim()
      const parentKey = item.parent?.trim().toUpperCase()
      const fingerprint = `${parentKey ?? ''}|${normalize(summary)}`
      if (!item.allow_duplicate) {
        if (seen.has(fingerprint)) {
          throw new JiraError(
            `Nothing created — item ${index + 1} ("${summary}") repeats an earlier item in this batch`
            + `${parentKey ? ` under ${parentKey}` : ''}. Set allow_duplicate=true on it if that is intended.`,
          )
        }
        const duplicate = await findDuplicate(config, client, project, summary, { parent: parentKey })
        if (duplicate) {
          throw new JiraError(
            `Nothing created — item ${index + 1} ("${summary}") duplicates ${duplicate.key} `
            + `(„${duplicate.fields?.summary}"). Set allow_duplicate=true on it if the user confirmed it.`,
          )
        }
      }
      seen.add(fingerprint)
      const { fields } = await buildIssueFields(item, { config, client, project, projectTypes })
      payload.push(fields)
    }

    const result = await client.createIssuesBulk(config, payload)
    const created = result?.issues ?? []
    const failed = new Map((result?.errors ?? []).map((error) => [error.failedElementNumber, error]))
    for (let n = 0; n < created.length; n += 1) consumeWriteBudget(config, 'create')

    const lines = [`Created ${created.length}/${items.length} issues in ${project}:`]
    let next = 0
    items.forEach((item, index) => {
      const summary = item.summary.trim()
      const error = failed.get(index)
      if (error) {
        lines.push(`- item ${index + 1} "${summary}": FAILED — ${describeError(error)}`)
        return
      }
      const issue = created[next]
      next += 1
      lines.push(`- ${issue?.key ?? '?'} "${summary}" — ${config.server}/browse/${issue?.key ?? ''}`)
    })
    if (failed.size) {
      lines.push(`${failed.size} item(s) failed — fix and create those again; the created ones are NOT rolled back.`)
    }
    return lines.join('\n')
  },
}
