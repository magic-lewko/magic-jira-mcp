import { z } from 'zod'
import { JiraError } from '../jira-client.mjs'
import { formatCycleLine, formatStatusCounts } from '../format.mjs'
import { cyclesFromResponse, resolveVersion, resolveZephyrProject } from '../zephyr.mjs'

/** Executions read for one cycle's detail. */
const DETAIL_LIMIT = 2000

/**
 * Non-zero per-status counts of an expanded cycle, most frequent first.
 *
 * @param {object} cycle - cycle listed with expand=executionSummaries
 * @returns {string}
 */
function summaryCounts(cycle) {
  return (cycle.executionSummaries?.executionSummary ?? [])
    .filter((s) => s.count > 0)
    .sort((a, b) => b.count - a.count)
    .map((s) => `${s.statusName} ${s.count}`)
    .join(' · ')
}

/** Zephyr test cycles (test plans) of a project, or the detail of one cycle. */
export default {
  name: 'list_test_cycles',
  config: {
    title: 'List Zephyr test cycles',
    description: 'Zephyr Squad test cycles (test runs / test plans) of a project: id, name, version, '
      + 'environment, build, dates, progress (executed/total, folders included) and status counts. With cycle_id: '
      + 'the detail of one cycle — status counts (PASS/FAIL/...) and per-folder progress. For the '
      + 'executions themselves use search_test_executions with ZQL `cycleId = <id>`.',
    inputSchema: {
      project: z.string().describe('Project key, e.g. "PROJ"'),
      version: z.string().optional().describe('Version name; omit for all versions, "Unscheduled" for none'),
      cycle_id: z.number().int().optional().describe('Cycle id for the detail of one cycle'),
    },
  },

  /**
   * @param {{project: string, version?: string, cycle_id?: number}} args
   * @param {{config: object, client: object}} ctx
   * @returns {Promise<string>}
   */
  async run({ project, version, cycle_id }, { config, client }) {
    const proj = await resolveZephyrProject(config, client, project)

    if (cycle_id !== undefined) {
      const cycle = await client.getTestCycle(config, cycle_id)
      if (String(cycle.projectId) !== proj.id) {
        throw new JiraError(`Cycle ${cycle_id} belongs to another project, not ${proj.key}.`)
      }
      const [folders, result] = await Promise.all([
        client.listCycleFolders(config, cycle_id, { projectId: proj.id, versionId: cycle.versionId }),
        client.searchExecutions(config, { zql: `cycleId = ${cycle_id}`, limit: DETAIL_LIMIT }),
      ])
      const executed = result.executions.filter((e) => String(e.executionStatus) !== '-1').length
      const out = [formatCycleLine({ ...cycle, id: cycle_id }, { executed, total: result.total, folders: folders.length })]
      if (cycle.description) out.push(`Description: ${cycle.description}`)
      out.push(`${config.server}/projects/${proj.key}?selectedItem=com.thed.zephyr.je:zephyr-tests-page#test-cycles-tab`)
      out.push('', result.executions.length
        ? `Statuses: ${formatStatusCounts(result.executions)}`
        : 'Statuses: no executions yet.')
      if (result.executions.length < result.total) out.push(`(counted ${result.executions.length} of ${result.total})`)
      if (folders.length) {
        out.push('', `FOLDERS (${folders.length}):`)
        for (const f of folders) {
          out.push(`- #${f.folderId} ${f.folderName} · executed ${f.totalExecuted ?? 0}/${f.totalExecutions ?? 0}`)
        }
      }
      return out.join('\n')
    }

    const versionId = version === undefined ? undefined : (await resolveVersion(config, client, proj.key, version)).id
    const cycles = cyclesFromResponse(await client.listTestCycles(config, proj.id, { versionId }))
    if (cycles.length === 0) {
      return `No test cycles in ${proj.key}${version ? ` for version "${version}"` : ''}.`
    }

    const lines = [`Test cycles in ${proj.key} (${cycles.length}, newest first):`]
    for (const cycle of cycles) {
      const line = formatCycleLine(cycle, {
        executed: cycle.totalExecuted ?? 0, total: cycle.totalExecutions ?? 0, folders: cycle.totalFolders ?? 0,
      })
      const counts = summaryCounts(cycle)
      lines.push(counts ? `${line} (${counts})` : line)
    }
    return lines.join('\n')
  },
}
