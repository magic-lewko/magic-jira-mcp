import { z } from 'zod'
import { JiraError } from '../jira-client.mjs'
import { assertWriteBudget, consumeWriteBudget, findDuplicate } from '../write-guard.mjs'
import { buildIssueFields, loadProjectTypes } from '../issue-fields.mjs'
import { MAX_STEPS, TEST_STEP_INPUT, addSteps, resolveZephyrProject } from '../zephyr.mjs'
import { loadRulesForWrite } from '../project-rules.mjs'

/** Test cases per call. */
const MAX_ITEMS = 25

/**
 * @param {string} s
 * @returns {string}
 */
function normalize(s) {
  return String(s ?? '').toLowerCase().replaceAll(/\s+/g, ' ').trim()
}

/**
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

const TEST_CASE_INPUT = {
  summary: z.string().min(5).describe('Test case title, e.g. "Login with a valid e-mail and password"'),
  description: z.string().optional().describe(
    'Preconditions and context in Markdown — converted to Jira wiki markup. '
    + 'Set description_format="wiki" to pass wiki markup through unchanged',
  ),
  description_format: z.enum(['markdown', 'wiki']).optional().describe('Format of description; default "markdown"'),
  steps: z.array(TEST_STEP_INPUT).max(MAX_STEPS).optional().describe(`Test steps in order (max ${MAX_STEPS})`),
  components: z.array(z.string()).optional().describe('Component names, e.g. ["Web"]'),
  labels: z.array(z.string()).optional(),
  assignee: z.string().optional().describe('Jira username to assign'),
  allow_duplicate: z.boolean().optional()
    .describe('Set true ONLY when the user explicitly confirmed creating a near-duplicate'),
}

/**
 * WRITE tool. Creates up to MAX_ITEMS Zephyr test cases (issue type "Test")
 * in one bulk request, then adds each test's steps. Same rails as
 * create_issues: the whole batch (issues + steps) must fit the session budget,
 * every item passes the duplicate guard, `ai-generated` label in code.
 */
export default {
  name: 'create_test_cases',
  config: {
    title: 'Create Zephyr test cases (WRITE)',
    description: `Create 1 to ${MAX_ITEMS} Zephyr test cases (Jira issues of type "Test") in ONE call, `
      + `each with up to ${MAX_STEPS} steps (action, test data, expected result). Call it ONLY after the `
      + '/jira-tools:test-cases dry-run and the user\'s explicit confirmation. Each test gets the '
      + 'ai-generated label. The whole batch (tests + steps) must fit the session write budget or '
      + 'nothing is created; an open issue with the same title blocks the batch unless '
      + 'allow_duplicate=true. Returns the keys; link them to the story with link_issues and put them '
      + 'into a cycle with add_tests_to_cycle.',
    inputSchema: {
      project: z.string().describe('Project key, e.g. "PROJ"'),
      items: z.array(z.object(TEST_CASE_INPUT)).min(1).max(MAX_ITEMS)
        .describe(`Test cases to create, in order (max ${MAX_ITEMS})`),
    },
  },

  /**
   * @param {{project: string, items: object[]}} args
   * @param {{config: object, client: object}} ctx
   * @returns {Promise<string>}
   */
  async run(args, { config, client }) {
    const { items } = args
    const stepCount = items.reduce((n, item) => n + (item.steps?.length ?? 0), 0)
    assertWriteBudget(config, 'create', items.length)
    assertWriteBudget(config, 'write', items.length + stepCount)

    const proj = await resolveZephyrProject(config, client, args.project, { requireTestType: true })
    const projectTypes = await loadProjectTypes(config, client, proj.key)
    const rules = items.some((item) => item.assignee)
      ? await loadRulesForWrite(config, client, proj.key)
      : { componentRules: [] }
    const seen = new Set()
    const payload = []
    const ruleNotes = []
    for (const [index, item] of items.entries()) {
      const summary = item.summary.trim()
      if (!item.allow_duplicate) {
        if (seen.has(normalize(summary))) {
          throw new JiraError(
            `Nothing created — item ${index + 1} ("${summary}") repeats an earlier item in this batch. `
            + 'Set allow_duplicate=true on it if that is intended.',
          )
        }
        const duplicate = await findDuplicate(config, client, proj.key, summary)
        if (duplicate) {
          throw new JiraError(
            `Nothing created — item ${index + 1} ("${summary}") duplicates ${duplicate.key} `
            + `(„${duplicate.fields?.summary}"). Set allow_duplicate=true on it if the user confirmed it.`,
          )
        }
      }
      seen.add(normalize(summary))
      const { fields, ruleComponents } = await buildIssueFields(
        { ...item, issue_type: proj.testType },
        { config, client, project: proj.key, projectTypes, componentRules: rules.componentRules },
      )
      payload.push(fields)
      ruleNotes.push(ruleComponents.length ? ` · +${ruleComponents.join(', ')} (project rule)` : '')
    }

    const result = await client.createIssuesBulk(config, payload)
    const created = result?.issues ?? []
    const failed = new Map((result?.errors ?? []).map((error) => [error.failedElementNumber, error]))
    for (let n = 0; n < created.length; n += 1) consumeWriteBudget(config, 'create')

    const lines = [`Created ${created.length}/${items.length} test cases in ${proj.key}:`]
    let next = 0
    let stepFailures = 0
    for (const [index, item] of items.entries()) {
      const summary = item.summary.trim()
      const error = failed.get(index)
      if (error) {
        lines.push(`- item ${index + 1} "${summary}": FAILED — ${describeError(error)}`)
        continue
      }
      const issue = created[next]
      next += 1
      const steps = item.steps ?? []
      let stepNote = 'no steps'
      if (steps.length) {
        const outcome = await addSteps(config, client, issue.id, steps, consumeWriteBudget)
        stepNote = `${outcome.added}/${steps.length} steps`
        if (outcome.error) {
          stepFailures += 1
          stepNote += ` — step ${outcome.added + 1} FAILED: ${outcome.error}`
        }
      }
      lines.push(`- ${issue.key} "${summary}" · ${stepNote}${ruleNotes[index]} — ${config.server}/browse/${issue.key}`)
    }
    if (failed.size) {
      lines.push(`${failed.size} test case(s) failed — fix and create those again; the created ones are NOT rolled back.`)
    }
    if (stepFailures) {
      lines.push('Add the missing steps with add_test_steps (only the steps after the last one added).')
    }
    if (rules.warning) lines.push(rules.warning)
    return lines.join('\n')
  },
}
