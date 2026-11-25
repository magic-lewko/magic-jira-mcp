import { z } from 'zod'
import { formatExecutionList } from '../format.mjs'

/** Zephyr test executions by ZQL — the read foundation for test runs. */
export default {
  name: 'search_test_executions',
  config: {
    title: 'Search Zephyr test executions (ZQL)',
    description: 'Run a Zephyr Query Language (ZQL) search over test executions (a test placed in a '
      + 'cycle). Returns one line per execution: execution id (needed by set_execution_status), status, '
      + 'test key and title, cycle / folder, version, who executed it and when, defects, comment, plus '
      + 'status counts. ZQL clauses: project, issue, cycleId, cycleName, folderId, folderName, '
      + 'fixVersion, executionStatus, executedBy, assignee, executionDate, creationDate, labels, '
      + 'component, priority, summary. Quote values with spaces. An unknown key in `issue in (...)` '
      + 'fails the whole query. Examples: '
      + '`project = PROJ AND cycleName = "Release 12" AND executionStatus = FAIL`, '
      + '`issue = PROJ-450`, `cycleId = 70 AND executionStatus = UNEXECUTED`.',
    inputSchema: {
      zql: z.string().min(1).describe('ZQL query'),
      max_results: z.number().int().min(1).max(500).optional().describe('Default 50, max 500'),
    },
  },

  /**
   * @param {{zql: string, max_results?: number}} args
   * @param {{config: object, client: object}} ctx
   * @returns {Promise<string>}
   */
  async run({ zql, max_results = 50 }, { config, client }) {
    const page = await client.searchExecutions(config, { zql: zql.trim(), limit: max_results })
    return formatExecutionList(page)
  },
}
