import { z } from 'zod'
import { assertWriteBudget, consumeWriteBudget } from '../write-guard.mjs'
import { AI_SIGNATURE, resolveExecutionStatus } from '../zephyr.mjs'

/** Executions per call. */
const MAX_EXECUTIONS = 50

/**
 * WRITE tool. Sets one status on up to MAX_EXECUTIONS executions. A comment,
 * when given, gets the AI signature; without one the tester's existing
 * comment is left untouched.
 */
export default {
  name: 'set_execution_status',
  config: {
    title: 'Set Zephyr execution status (WRITE)',
    description: `Record a test result: set ONE status (PASS, FAIL, WIP, BLOCKED, UNEXECUTED or a custom `
      + `one, matched case-insensitively) on up to ${MAX_EXECUTIONS} executions. Execution ids come from `
      + 'search_test_executions or add_tests_to_cycle. An optional comment (e.g. what failed) replaces '
      + 'the execution comment and gets the AI signature; without a comment the existing one stays. '
      + 'Each execution counts against the per-session write budget.',
    inputSchema: {
      execution_ids: z.array(z.number().int()).min(1).max(MAX_EXECUTIONS).describe('Execution ids, e.g. [9001]'),
      status: z.string().min(1).describe('Status name, e.g. "PASS" or "FAIL"'),
      comment: z.string().optional().describe('Execution comment, e.g. the actual result of a failed step'),
    },
  },

  /**
   * @param {{execution_ids: number[], status: string, comment?: string}} args
   * @param {{config: object, client: object}} ctx
   * @returns {Promise<string>}
   */
  async run({ execution_ids, status, comment }, { config, client }) {
    const ids = [...new Set(execution_ids)]
    const target = resolveExecutionStatus(await client.listExecutionStatuses(config), status)
    assertWriteBudget(config, 'write', ids.length)
    const text = comment?.trim() ? `${comment.trim()}\n\n${AI_SIGNATURE}` : undefined

    const lines = []
    let done = 0
    for (const id of ids) {
      try {
        consumeWriteBudget(config, 'write')
        const execution = await client.updateExecutionStatus(config, id, { status: target.id, comment: text })
        done += 1
        const where = execution?.cycleName ? ` · ${execution.cycleName}${execution.folderName ? ` / ${execution.folderName}` : ''}` : ''
        lines.push(`- #${id} ${execution?.issueKey ?? ''}${where}`.trimEnd())
      } catch (err) {
        lines.push(`- #${id}: FAILED — ${err?.message ?? err}`)
      }
    }
    return [`Set ${target.name} on ${done}/${ids.length} executions:`, ...lines].join('\n')
  },
}
