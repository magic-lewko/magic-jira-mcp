/**
 * @fileoverview Tool registry. One file = one MCP tool (SPEC §3).
 *
 * Read and write tools are ALWAYS registered — there is no write-mode gate.
 * Write safety lives inside the tools (session budget, duplicate guard) and
 * in the skills' mandatory dry-run (see write-guard.mjs, SPEC §4.2).
 */

import addAttachment from './add-attachment.mjs'
import addComment from './add-comment.mjs'
import assignToEpic from './assign-to-epic.mjs'
import createIssue from './create-issue.mjs'
import createIssues from './create-issues.mjs'
import linkIssues from './link-issues.mjs'
import searchIssues from './search-issues.mjs'
import transitionIssue from './transition-issue.mjs'
import updateIssue from './update-issue.mjs'
import getIssue from './get-issue.mjs'
import listBoards from './list-boards.mjs'
import getActiveSprint from './get-active-sprint.mjs'
import getSprintIssues from './get-sprint-issues.mjs'
import getEpicStatus from './get-epic-status.mjs'
import getIssueChangelog from './get-issue-changelog.mjs'
import getCurrentUser from './get-current-user.mjs'
import getProjectConfig from './get-project-config.mjs'
import getVersion from './get-version.mjs'

/** Read-only tools. */
export const readTools = [
  searchIssues,
  getIssue,
  listBoards,
  getActiveSprint,
  getSprintIssues,
  getEpicStatus,
  getIssueChangelog,
  getCurrentUser,
  getProjectConfig,
  getVersion,
]

/** Write tools — guarded in code by the session budget and the duplicate guard. */
export const writeTools = [
  createIssue,
  createIssues,
  updateIssue,
  addComment,
  addAttachment,
  transitionIssue,
  assignToEpic,
  linkIssues,
]
