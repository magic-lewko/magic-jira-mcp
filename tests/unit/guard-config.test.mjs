import { test } from 'node:test'
import assert from 'node:assert/strict'

import { decide } from '../../plugins/jira-tools/hooks/guard-config.mjs'

const CONFIG_PATH = 'C:\\Users\\someone\\.config\\jira-tools\\config.json'

const CURRENT = JSON.stringify({
  server: 'https://jira.example.pl',
  token: 't',
  allowWrite: false,
  projects: { PROJ: { boardId: 1, allowWrite: false } },
}, null, 2)

/** readFile stub returning the canned current config. */
const readCurrent = () => CURRENT

function editPayload(oldString, newString, replaceAll = false) {
  return {
    tool_name: 'Edit',
    tool_input: { file_path: CONFIG_PATH, old_string: oldString, new_string: newString, replace_all: replaceAll },
  }
}

test('other files are ignored', () => {
  const payload = { tool_name: 'Edit', tool_input: { file_path: 'C:/repo/src/app.mjs', old_string: 'allowWrite', new_string: 'x' } }
  assert.equal(decide(payload, readCurrent), null)
})

test('Write flipping global allowWrite → ask', () => {
  const next = CURRENT.replace('"allowWrite": false', '"allowWrite": true')
  const payload = { tool_name: 'Write', tool_input: { file_path: CONFIG_PATH, content: next } }
  assert.match(decide(payload, readCurrent), /bezpiecznik zapisu/)
})

test('Write with unchanged switches (e.g. language change) → no opinion', () => {
  const next = CURRENT.replace('"token": "t"', '"token": "t", "language": "en"')
  const payload = { tool_name: 'Write', tool_input: { file_path: CONFIG_PATH, content: next } }
  assert.equal(decide(payload, readCurrent), null)
})

test('first setup (config does not exist yet) → no opinion', () => {
  const payload = {
    tool_name: 'Write',
    tool_input: { file_path: CONFIG_PATH, content: '{"server":"x","token":"y","allowWrite":true}' },
  }
  const noFile = () => { throw new Error('ENOENT') }
  assert.equal(decide(payload, noFile), null)
})

test('Edit changing a project allowWrite → ask', () => {
  const payload = editPayload('"boardId": 1,\n      "allowWrite": false', '"boardId": 1,\n      "allowWrite": true')
  assert.match(decide(payload, readCurrent), /bezpiecznik zapisu/)
})

test('sneaky replace_all false→true without the word allowWrite → ask (simulation catches it)', () => {
  const payload = editPayload('false', 'true', true)
  assert.match(decide(payload, readCurrent), /bezpiecznik zapisu/)
})

test('Edit touching an unrelated field → no opinion', () => {
  const payload = editPayload('"server": "https://jira.example.pl"', '"server": "https://jira2.example.pl"')
  assert.equal(decide(payload, readCurrent), null)
})

test('MultiEdit: any edit flipping a switch → ask', () => {
  const payload = {
    tool_name: 'MultiEdit',
    tool_input: {
      file_path: CONFIG_PATH,
      edits: [
        { old_string: '"token": "t"', new_string: '"token": "t2"' },
        { old_string: '"allowWrite": false,', new_string: '"allowWrite": true,' },
      ],
    },
  }
  assert.match(decide(payload, readCurrent), /bezpiecznik zapisu/)
})

test('Write replacing config with non-JSON that mentions allowWrite → ask', () => {
  const payload = { tool_name: 'Write', tool_input: { file_path: CONFIG_PATH, content: 'allowWrite=true' } }
  assert.match(decide(payload, readCurrent), /bezpiecznik zapisu/)
})

test('Bash touching the config AND allowWrite → ask; unrelated bash → no opinion', () => {
  const sed = {
    tool_name: 'Bash',
    tool_input: { command: 'sed -i "s/\\"allowWrite\\": false/\\"allowWrite\\": true/" ~/.config/jira-tools/config.json' },
  }
  assert.match(decide(sed, readCurrent), /bezpiecznik zapisu/)

  const ls = { tool_name: 'Bash', tool_input: { command: 'ls -la' } }
  assert.equal(decide(ls, readCurrent), null)

  const readOnly = { tool_name: 'Bash', tool_input: { command: 'cat ~/.config/jira-tools/config.json' } }
  assert.equal(decide(readOnly, readCurrent), null)
})

test('read-only tools are never questioned', () => {
  const payload = { tool_name: 'Read', tool_input: { file_path: CONFIG_PATH } }
  assert.equal(decide(payload, readCurrent), null)
})
