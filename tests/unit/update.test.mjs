import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  RELEASE_BASE, compareVersions, downloadBundle, fetchLatest, updateStatusLine,
} from '../../plugins/jira-tools/src/update.mjs'
import downloadUpdate from '../../plugins/jira-tools/src/tools/download-update.mjs'
import getVersion from '../../plugins/jira-tools/src/tools/get-version.mjs'
import { VERSION } from '../../plugins/jira-tools/src/version.mjs'

const ENV_KEYS = ['JIRA_CLIENT', 'JIRA_DOWNLOAD_DIR', 'JIRA_NO_UPDATE_CHECK']
const realFetch = globalThis.fetch
const savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))
const tmpDirs = []

afterEach(() => {
  globalThis.fetch = realFetch
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
  for (const dir of tmpDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

const BUNDLE = Buffer.from('PK\u0003\u0004 fake bundle bytes')
const SHA = createHash('sha256').update(BUNDLE).digest('hex')
const NEWER = '99.0.0'

/** A feed entry for `version` (defaults to a matching checksum). */
function feed(version, extra = {}) {
  return { version, file: 'jira-tools.mcpb', sha256: SHA, size: BUNDLE.length, ...extra }
}

/** Fake fetch: serves latest.json and the bundle, records requested URLs. */
function mockFeed(latest, { status = 200, bundle = BUNDLE } = {}) {
  const urls = []
  globalThis.fetch = async (url) => {
    urls.push(String(url))
    if (String(url).endsWith('latest.json')) {
      return new Response(status === 200 ? JSON.stringify(latest) : 'nope', { status })
    }
    return new Response(bundle, { status: 200 })
  }
  return urls
}

/** Fresh temp folder as the download target. */
function useTempDownloadDir() {
  const dir = mkdtempSync(join(tmpdir(), 'jira-tools-update-'))
  tmpDirs.push(dir)
  process.env.JIRA_DOWNLOAD_DIR = dir
  return dir
}

// --- version compare ---------------------------------------------------------

test('compareVersions compares numerically, not lexically', () => {
  assert.equal(compareVersions('0.7.0', '0.8.0'), -1)
  assert.equal(compareVersions('0.10.0', '0.9.1'), 1)
  assert.equal(compareVersions('1.0', '1.0.0'), 0)
})

// --- feed --------------------------------------------------------------------

test('fetchLatest reads the feed from the main branch', async () => {
  const urls = mockFeed(feed(NEWER))
  const latest = await fetchLatest()
  assert.equal(latest.version, NEWER)
  assert.deepEqual(urls, [`${RELEASE_BASE}latest.json`])
})

test('fetchLatest explains a missing release, a bad feed and no connection', async () => {
  mockFeed(feed(NEWER), { status: 404 })
  await assert.rejects(fetchLatest(), /no release published yet/)

  mockFeed({ version: NEWER }) // no file / sha256
  await assert.rejects(fetchLatest(), /malformed/)

  globalThis.fetch = async () => { throw new TypeError('fetch failed') }
  await assert.rejects(fetchLatest(), /no connection/)
})

// --- download ----------------------------------------------------------------

test('downloadBundle verifies the checksum and saves jira-tools-<version>.mcpb', async () => {
  const dir = useTempDownloadDir()
  const urls = mockFeed(feed(NEWER))
  const path = await downloadBundle(feed(NEWER), dir)
  assert.equal(path, join(dir, `jira-tools-${NEWER}.mcpb`))
  assert.deepEqual(readFileSync(path), BUNDLE)
  assert.deepEqual(urls, [`${RELEASE_BASE}jira-tools.mcpb`])
})

test('downloadBundle refuses a checksum mismatch and writes nothing', async () => {
  const dir = useTempDownloadDir()
  mockFeed(feed(NEWER))
  await assert.rejects(downloadBundle(feed(NEWER, { sha256: 'deadbeef' }), dir), /checksum mismatch/)
  assert.equal(existsSync(join(dir, `jira-tools-${NEWER}.mcpb`)), false)
})

// --- download_update tool ----------------------------------------------------

test('download_update in Claude Desktop downloads a newer bundle and explains the install', async () => {
  process.env.JIRA_CLIENT = 'desktop'
  const dir = useTempDownloadDir()
  const urls = mockFeed(feed(NEWER))
  const text = await downloadUpdate.run({})
  assert.match(text, new RegExp(`Latest release: ${NEWER}, you run ${VERSION.replace(/\./g, '\.')}`))
  assert.match(text, /File: .*jira-tools-99\.0\.0\.mcpb/)
  assert.match(text, /double-click the file/)
  assert.equal(existsSync(join(dir, `jira-tools-${NEWER}.mcpb`)), true)
  assert.equal(urls.length, 2)
})

test('download_update skips the download when already on the latest, unless force=true', async () => {
  process.env.JIRA_CLIENT = 'desktop'
  const dir = useTempDownloadDir()
  const urls = mockFeed(feed(VERSION))
  const text = await downloadUpdate.run({})
  assert.match(text, /You already run .* the latest release\. Nothing downloaded/)
  assert.equal(urls.length, 1)

  const forced = await downloadUpdate.run({ force: true })
  assert.match(forced, /File: /)
  assert.equal(existsSync(join(dir, `jira-tools-${VERSION}.mcpb`)), true)
})

test('download_update in Claude Code reports the marketplace commands instead of a file', async () => {
  delete process.env.JIRA_CLIENT
  useTempDownloadDir()
  const urls = mockFeed(feed(NEWER))
  const text = await downloadUpdate.run({})
  assert.match(text, /\/plugin marketplace update magic-jira-mcp/)
  assert.match(text, /force=true/)
  assert.equal(urls.length, 1)
})

test('download_update surfaces a failed check as a clean error', async () => {
  process.env.JIRA_CLIENT = 'desktop'
  globalThis.fetch = async () => { throw new TypeError('fetch failed') }
  await assert.rejects(downloadUpdate.run({}), { name: 'JiraError', message: /Update check failed: no connection/ })
})

// --- get_version status line -------------------------------------------------

test('updateStatusLine reports newer, same and ahead versions and never throws', async () => {
  delete process.env.JIRA_CLIENT
  mockFeed(feed(NEWER))
  assert.match(await updateStatusLine(), /version 99\.0\.0 is available .* \/plugin marketplace update/)
  assert.match(await updateStatusLine({ current: NEWER }), /up to date/)
  assert.match(await updateStatusLine({ current: '100.0.0' }), /ahead of the latest release/)

  process.env.JIRA_CLIENT = 'desktop'
  assert.match(await updateStatusLine(), /Call download_update/)

  globalThis.fetch = async () => { throw new TypeError('fetch failed') }
  assert.match(await updateStatusLine(), /Update check failed: no connection/)
})

test('get_version appends the update line and honours JIRA_NO_UPDATE_CHECK', async () => {
  mockFeed(feed(NEWER))
  const text = await getVersion.run({}, { config: null })
  assert.match(text, /jira-tools MCP server v\d+\.\d+\.\d+/)
  assert.match(text, /Update check: version 99\.0\.0 is available/)

  process.env.JIRA_NO_UPDATE_CHECK = '1'
  const silent = await getVersion.run({}, { config: null })
  assert.match(silent, /Update check: disabled/)
})
