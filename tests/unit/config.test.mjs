import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { loadConfig, getProjectProfile, DEFAULT_STATUSES } from '../../plugins/jira-tools/src/config.mjs'

/** Create a temp config file and return its path (caller cleans the dir). */
function tempConfig(content) {
  const dir = mkdtempSync(join(tmpdir(), 'jira-tools-test-'))
  const path = join(dir, 'config.json')
  writeFileSync(path, JSON.stringify(content))
  return { dir, path }
}

test('env vars win over file values per key', () => {
  const { dir, path } = tempConfig({
    server: 'https://jira.file.example.pl', token: 'file-token', language: 'en',
  })
  try {
    const config = loadConfig({
      env: { JIRA_SERVER: 'https://jira.env.example.pl' },
      path,
    })
    assert.equal(config.server, 'https://jira.env.example.pl')
    assert.equal(config.token, 'file-token')
    assert.equal(config.language, 'en')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('file alone is enough; defaults applied; trailing slash trimmed', () => {
  const { dir, path } = tempConfig({ server: 'https://jira.example.pl///', token: 't' })
  try {
    const config = loadConfig({ env: {}, path })
    assert.equal(config.server, 'https://jira.example.pl')
    assert.equal(config.language, 'pl')
    assert.equal(config.defaultProject, undefined)
    assert.deepEqual(config.projects, {})
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('no env and no file → null (not configured)', () => {
  const config = loadConfig({ env: {}, path: join(tmpdir(), 'nope', 'missing-config.json') })
  assert.equal(config, null)
})

test('server without token (and vice versa) → null', () => {
  assert.equal(loadConfig({ env: { JIRA_SERVER: 'https://jira.example.pl' }, path: 'missing.json' }), null)
  assert.equal(loadConfig({ env: { JIRA_TOKEN: 'secret' }, path: 'missing.json' }), null)
})

test('project profiles: saved profile wins, unknown project falls back to defaults', () => {
  const { dir, path } = tempConfig({
    server: 'https://jira.example.pl',
    token: 't',
    projects: {
      PROJ: { boardId: 7, statuses: ['Open', 'Closed'], epicLinkField: 'customfield_10008' },
    },
  })
  try {
    const config = loadConfig({ env: {}, path })

    const known = getProjectProfile(config, 'proj')
    assert.equal(known.boardId, 7)
    assert.deepEqual(known.statuses, ['Open', 'Closed'])
    assert.equal(known.epicLinkField, 'customfield_10008')

    const unknown = getProjectProfile(config, 'OTHER')
    assert.deepEqual(unknown.statuses, DEFAULT_STATUSES)
    assert.equal(unknown.boardId, undefined)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('corrupted config file is treated as absent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'jira-tools-test-'))
  const path = join(dir, 'config.json')
  writeFileSync(path, '{not json')
  try {
    assert.equal(loadConfig({ env: {}, path }), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
