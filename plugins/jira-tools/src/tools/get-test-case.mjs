import { z } from 'zod'
import { JiraError } from '../jira-client.mjs'
import { formatExecutionLine, formatTestSteps } from '../format.mjs'
import { isZephyrTestType } from '../zephyr.mjs'

/** Executions listed with a test case. */
const EXECUTION_LIMIT = 20

/** Description cap (context economy, SPEC §4.3). */
const DESCRIPTION_LIMIT = 4000

/** One Zephyr test case: meta, description, steps and where it was executed. */
export default {
  name: 'get_test_case',
  config: {
    title: 'Get Zephyr test case',
    description: 'One Zephyr test case (Jira issue of type "Test"): status, labels, components, '
      + `description, all test steps (action, test data, expected result) and its last ${EXECUTION_LIMIT} `
      + 'executions (cycle / folder, status, who, when).',
    inputSchema: {
      key: z.string().describe('Test issue key, e.g. "PROJ-450"'),
    },
  },

  /**
   * @param {{key: string}} args
   * @param {{config: object, client: object}} ctx
   * @returns {Promise<string>}
   */
  async run({ key }, { config, client }) {
    const issueKey = key.trim().toUpperCase()
    const issue = await client.getIssue(config, issueKey, {
      fields: ['summary', 'status', 'issuetype', 'priority', 'assignee', 'labels', 'components', 'description'],
    })
    const f = issue.fields ?? {}
    if (!isZephyrTestType(f.issuetype)) {
      throw new JiraError(`${issueKey} is a ${f.issuetype?.name ?? '?'}, not a Zephyr test — use get_issue.`)
    }
    const [steps, runs] = await Promise.all([
      client.getTestSteps(config, issue.id),
      client.searchExecutions(config, { zql: `issue = ${issueKey} ORDER BY executionDate DESC`, limit: EXECUTION_LIMIT }),
    ])

    const out = [
      `${issueKey} — ${f.summary ?? '(no title)'}`,
      `${f.issuetype?.name} · ${f.priority?.name ?? '?'} · ${f.status?.name ?? '?'} · ${f.assignee?.displayName ?? 'Unassigned'}`,
    ]
    const meta = []
    if ((f.components ?? []).length) meta.push(`components: ${f.components.map((c) => c.name).join(', ')}`)
    if ((f.labels ?? []).length) meta.push(`labels: ${f.labels.join(', ')}`)
    if (meta.length) out.push(meta.join(' · '))
    out.push(`${config.server}/browse/${issueKey}`)

    let description = String(f.description ?? '').trim()
    if (description.length > DESCRIPTION_LIMIT) description = `${description.slice(0, DESCRIPTION_LIMIT)}\n… (description truncated)`
    if (description) out.push('', 'DESCRIPTION:', description)

    out.push(...formatTestSteps(steps))

    out.push('', runs.total
      ? `EXECUTIONS (${runs.executions.length < runs.total ? `last ${runs.executions.length} of ${runs.total}` : runs.total}):`
      : 'EXECUTIONS: none — the test is not in any cycle yet.')
    for (const e of runs.executions) out.push(formatExecutionLine(e))
    return out.join('\n')
  },
}
