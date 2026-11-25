import { z } from 'zod'
import { JiraError } from '../jira-client.mjs'
import { consumeWriteBudget } from '../write-guard.mjs'
import { AI_SIGNATURE, cyclesFromResponse, resolveVersion, resolveZephyrProject, toZephyrDate } from '../zephyr.mjs'

/**
 * WRITE tool. Creates exactly ONE Zephyr test cycle (a test plan / test run)
 * in a project version. Rails: session budget and a duplicate guard on the
 * name within the same version (allow_duplicate=true only after explicit
 * user confirmation). The description always ends with the AI signature.
 */
export default {
  name: 'create_test_cycle',
  config: {
    title: 'Create Zephyr test cycle (WRITE)',
    description: 'Create ONE Zephyr test cycle (test plan / test run) in a project version '
      + '(default "Unscheduled"). Returns the cycle id for add_tests_to_cycle. Dates are optional, '
      + 'YYYY-MM-DD. Refuses when the version already has a cycle with the same name, unless '
      + 'allow_duplicate=true. Counts against the per-session write budget.',
    inputSchema: {
      project: z.string().describe('Project key, e.g. "PROJ"'),
      name: z.string().min(1).describe('Cycle name, e.g. "Release 12 regression"'),
      version: z.string().optional().describe('Version name; default "Unscheduled"'),
      description: z.string().optional(),
      build: z.string().optional().describe('Build under test, e.g. "3.11.0 (2867)"'),
      environment: z.string().optional().describe('Environment, e.g. "UAT"'),
      start_date: z.string().optional().describe('Planned start, YYYY-MM-DD'),
      end_date: z.string().optional().describe('Planned end, YYYY-MM-DD'),
      allow_duplicate: z.boolean().optional()
        .describe('Create even though a cycle with this name exists — only after the user explicitly confirmed it'),
    },
  },

  /**
   * @param {{project: string, name: string, version?: string, description?: string, build?: string, environment?: string, start_date?: string, end_date?: string, allow_duplicate?: boolean}} args
   * @param {{config: object, client: object}} ctx
   * @returns {Promise<string>}
   */
  async run(args, { config, client }) {
    const name = args.name.trim()
    if (!name) throw new JiraError('Cycle name must not be empty.')
    const startDate = args.start_date ? toZephyrDate(args.start_date, 'start_date') : undefined
    const endDate = args.end_date ? toZephyrDate(args.end_date, 'end_date') : undefined
    if (startDate && endDate && args.end_date.trim() < args.start_date.trim()) {
      throw new JiraError('end_date must not be before start_date.')
    }

    const proj = await resolveZephyrProject(config, client, args.project, { requireTestType: true })
    const version = await resolveVersion(config, client, proj.key, args.version)

    if (!args.allow_duplicate) {
      const cycles = cyclesFromResponse(await client.listTestCycles(config, proj.id, { versionId: version.id }))
      const duplicate = cycles.find((c) => String(c.name ?? '').trim().toLowerCase() === name.toLowerCase())
      if (duplicate) {
        throw new JiraError(
          `Not created — version "${version.name}" of ${proj.key} already has a test cycle named `
          + `"${duplicate.name}" (id ${duplicate.id}). If a second one is intended and the user confirmed it, `
          + 'call again with allow_duplicate=true.',
        )
      }
    }

    const description = args.description?.trim() ? `${args.description.trim()}\n\n${AI_SIGNATURE}` : AI_SIGNATURE
    consumeWriteBudget(config, 'write')
    const created = await client.createTestCycle(config, {
      projectId: proj.id,
      versionId: version.id,
      name,
      description,
      build: args.build,
      environment: args.environment,
      startDate,
      endDate,
    })
    return `Created test cycle "${name}" (id ${created?.id ?? '?'}) in ${proj.key} / ${version.name} — `
      + `${config.server}/projects/${proj.key}?selectedItem=com.thed.zephyr.je:zephyr-tests-page#test-cycles-tab`
  },
}
