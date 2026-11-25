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
import createSprint from './create-sprint.mjs'
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
import getProjectRules from './get-project-rules.mjs'
import setProjectRules from './set-project-rules.mjs'
import getVersion from './get-version.mjs'
import downloadUpdate from './download-update.mjs'
import listTestCycles from './list-test-cycles.mjs'
import searchTestExecutions from './search-test-executions.mjs'
import getTestCase from './get-test-case.mjs'
import createTestCases from './create-test-cases.mjs'
import addTestSteps from './add-test-steps.mjs'
import createTestCycle from './create-test-cycle.mjs'
import addTestsToCycle from './add-tests-to-cycle.mjs'
import setExecutionStatus from './set-execution-status.mjs'

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
  getProjectRules,
  getVersion,
  downloadUpdate,
  listTestCycles,
  searchTestExecutions,
  getTestCase,
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
  createSprint,
  setProjectRules,
  createTestCases,
  addTestSteps,
  createTestCycle,
  addTestsToCycle,
  setExecutionStatus,
]
