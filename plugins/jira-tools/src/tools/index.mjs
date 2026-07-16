/**
 * @fileoverview Tool registry. One file = one MCP tool (SPEC §3).
 *
 * Write tools (Phase 2: create_issue, add_comment, transition_issue) will land
 * in `writeTools` and are registered ONLY when JIRA_ALLOW_WRITE=true —
 * the gate lives in server.mjs and is already tested.
 */

import addComment from './add-comment.mjs'
import assignToEpic from './assign-to-epic.mjs'
import createIssue from './create-issue.mjs'
import searchIssues from './search-issues.mjs'
import transitionIssue from './transition-issue.mjs'
import getIssue from './get-issue.mjs'
import listBoards from './list-boards.mjs'
import getActiveSprint from './get-active-sprint.mjs'
import getSprintIssues from './get-sprint-issues.mjs'
import getEpicStatus from './get-epic-status.mjs'
import getIssueChangelog from './get-issue-changelog.mjs'
import getCurrentUser from './get-current-user.mjs'
import getProjectConfig from './get-project-config.mjs'

/** Read-only tools — always registered. */
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
]

/** Write tools — registered only behind JIRA_ALLOW_WRITE=true (gate in server.mjs). */
export const writeTools = [
  createIssue,
  addComment,
  transitionIssue,
  assignToEpic,
]
