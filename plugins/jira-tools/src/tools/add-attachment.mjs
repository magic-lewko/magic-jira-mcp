import { readFileSync, statSync } from 'node:fs'
import { basename } from 'node:path'
import { z } from 'zod'
import { JiraError } from '../jira-client.mjs'
import { consumeWriteBudget } from '../write-guard.mjs'

/** Refuse oversized uploads early (Jira limits vary; this is our own sanity cap). */
const MAX_BYTES = 10 * 1024 * 1024

/**
 * WRITE tool. Registered only behind JIRA_ALLOW_WRITE=true.
 *
 * Uploads ONE local file as an issue attachment. The file must exist on disk
 * and the path must come explicitly from the user — an image merely pasted into
 * the conversation is NOT a file the server can read (it never leaves the
 * model's context). No globs, no directory walking: exactly one named path.
 */
export default {
  name: 'add_attachment',
  config: {
    title: 'Attach a file (WRITE)',
    description: 'Upload ONE local file (e.g. a screenshot) as an attachment to a Jira issue. '
      + 'Requires an absolute path to an existing file — pass ONLY a path the user gave you '
      + 'explicitly, never a guessed or globbed one. An image pasted into the chat is not a '
      + 'file: ask the user to save it first (e.g. Win+Shift+S, then Save as) and give the path. '
      + 'Confirm the file name with the user before calling. Counts against the write budget.',
    inputSchema: {
      key: z.string().describe('Issue key, e.g. "PROJ-42"'),
      path: z.string().describe('Absolute path to the file to upload, given by the user'),
      filename: z.string().optional().describe('Override the attachment name (default: the file name)'),
    },
  },

  /**
   * @param {{key: string, path: string, filename?: string}} args
   * @param {{config: object, client: object}} ctx
   * @returns {Promise<string>}
   */
  async run({ key, path, filename }, { config, client }) {
    const issueKey = key.trim().toUpperCase()

    let size
    try {
      const stats = statSync(path)
      if (!stats.isFile()) throw new Error('not a file')
      size = stats.size
    } catch {
      throw new JiraError(
        `File not found: ${path}. Provide the full path to an existing file `
        + '(save an image pasted into the chat to disk first).',
      )
    }
    if (size > MAX_BYTES) {
      throw new JiraError(`File is too large (${Math.round(size / 1024 / 1024)} MB, limit ${MAX_BYTES / 1024 / 1024} MB).`)
    }

    const name = (filename ?? basename(path)).trim()
    consumeWriteBudget(config, 'write')
    await client.addAttachment(config, issueKey, { filename: name, bytes: readFileSync(path) })
    return `Added attachment "${name}" (${Math.max(1, Math.round(size / 1024))} kB) do ${issueKey} — ${config.server}/browse/${issueKey}`
  },
}
