/**
 * Download the newest Claude Desktop bundle (.mcpb) into the Downloads folder.
 * The install itself stays a double-click: Claude Desktop never auto-updates a
 * sideloaded bundle. In Claude Code the plugin updates through the marketplace,
 * so the tool reports those commands instead of downloading a file.
 */
import { z } from 'zod'
import {
  compareVersions, downloadBundle, downloadDir, fetchLatest, isDesktop, updateHint,
} from '../update.mjs'
import { VERSION } from '../version.mjs'

export default {
  name: 'download_update',
  // Works without a Jira config — updating is exactly what a broken setup needs.
  alwaysAvailable: true,
  config: {
    title: 'Download the newest version',
    description: 'Download the newest jira-tools version: fetches the latest Claude Desktop bundle (.mcpb) '
      + 'into the Downloads folder and explains the install (double-click the file). '
      + 'Use when the user asks to update, upgrade, or get the latest version of jira-tools. '
      + 'In Claude Code it reports the plugin update commands instead.',
    inputSchema: {
      force: z.boolean().optional()
        .describe('Download the file even when the running version is already the latest, or when running in Claude Code.'),
    },
  },

  /**
   * @param {{force?: boolean}} args
   * @returns {Promise<string>}
   */
  async run({ force = false } = {}) {
    const latest = await fetchLatest()
    const cmp = compareVersions(VERSION, latest.version)
    const status = cmp < 0
      ? `Latest release: ${latest.version}, you run ${VERSION}.`
      : `You already run ${VERSION}${cmp > 0 ? `, ahead of the latest release ${latest.version}` : ', the latest release'}.`

    if (!isDesktop() && !force) {
      return `${status} This is the Claude Code plugin, so no file is needed. ${updateHint()}\n`
        + 'Pass force=true to download the Claude Desktop .mcpb file anyway.'
    }
    if (cmp >= 0 && !force) {
      return `${status} Nothing downloaded. Pass force=true to download the file anyway.`
    }

    const path = await downloadBundle(latest, downloadDir())
    return [
      `${status} Downloaded jira-tools ${latest.version}.`,
      `File: ${path}`,
      'Install: double-click the file. Claude Desktop replaces the current version and restarts the tools.',
      'If nothing happens: Settings > Extensions > Advanced settings > Install Extension, then pick the file.',
    ].join('\n')
  },
}
