import { z } from 'zod'
import { JiraError } from '../jira-client.mjs'
import { assertWriteBudget, consumeWriteBudget } from '../write-guard.mjs'
import { MAX_STEPS, TEST_STEP_INPUT, addSteps, isZephyrTestType } from '../zephyr.mjs'

/** WRITE tool. Appends steps to ONE existing Zephyr test; each step counts against the budget. */
export default {
  name: 'add_test_steps',
  config: {
    title: 'Add Zephyr test steps (WRITE)',
    description: `Append up to ${MAX_STEPS} steps (action, test data, expected result) to ONE existing `
      + 'Zephyr test, after its current steps. Existing steps are not changed. Each step counts '
      + 'against the per-session write budget.',
    inputSchema: {
      key: z.string().describe('Test issue key, e.g. "PROJ-450"'),
      steps: z.array(TEST_STEP_INPUT).min(1).max(MAX_STEPS).describe('Steps to append, in order'),
    },
  },

  /**
   * @param {{key: string, steps: object[]}} args
   * @param {{config: object, client: object}} ctx
   * @returns {Promise<string>}
   */
  async run({ key, steps }, { config, client }) {
    const issueKey = key.trim().toUpperCase()
    assertWriteBudget(config, 'write', steps.length)
    const issue = await client.getIssue(config, issueKey, { fields: ['issuetype', 'summary'] })
    if (!isZephyrTestType(issue.fields?.issuetype)) {
      throw new JiraError(`${issueKey} is a ${issue.fields?.issuetype?.name ?? '?'}, not a Zephyr test — steps exist only on tests.`)
    }
    const outcome = await addSteps(config, client, issue.id, steps, consumeWriteBudget)
    const head = `Added ${outcome.added}/${steps.length} steps to ${issueKey} — ${config.server}/browse/${issueKey}`
    return outcome.error ? `${head}\nStep ${outcome.added + 1} FAILED: ${outcome.error}` : head
  },
}
