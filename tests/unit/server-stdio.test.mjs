import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SRC_ENTRY = join(root, 'plugins', 'jira-tools', 'src', 'main.mjs')
const BUNDLE = join(root, 'plugins', 'jira-tools', 'servers', 'jira-mcp.mjs')

/**
 * Spawn the server, run the MCP initialize handshake + tools/list over stdio
 * and assert stdout carries ONLY protocol JSON (a stray console.log breaks
 * this test — by design).
 */
async function handshake(entry) {
  const child = spawn(process.execPath, [entry], {
    env: {
      ...process.env,
      JIRA_SERVER: 'https://jira.example.pl',
      JIRA_TOKEN: 'test-token',
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  const messages = []
  let buffer = ''
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString()
    let idx
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim()
      buffer = buffer.slice(idx + 1)
      if (!line) continue
      messages.push(JSON.parse(line)) // throws on non-protocol stdout noise
    }
  })

  const send = (msg) => child.stdin.write(`${JSON.stringify(msg)}\n`)
  const waitFor = (id, timeoutMs = 5000) => new Promise((resolve, reject) => {
    const started = Date.now()
    const tick = () => {
      const found = messages.find((m) => m.id === id)
      if (found) return resolve(found)
      if (Date.now() - started > timeoutMs) return reject(new Error(`timeout waiting for response id=${id}`))
      setTimeout(tick, 25)
    }
    tick()
  })

  try {
    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'smoke-test', version: '0.0.0' },
      },
    })
    const init = await waitFor(1)
    assert.equal(init.result.serverInfo.name, 'jira')

    send({ jsonrpc: '2.0', method: 'notifications/initialized' })
    send({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
    const list = await waitFor(2)
    const names = list.result.tools.map((t) => t.name)
    assert.ok(names.includes('search_issues'), `tools/list should include search_issues, got: ${names}`)
    assert.ok(names.includes('get_issue'), 'tools/list should include get_issue')
    assert.ok(names.includes('create_issue'), 'write tools are always registered (no write-mode)')
  } finally {
    child.kill()
  }
}

test('stdio smoke: source entry answers initialize + tools/list with clean stdout', async () => {
  await handshake(SRC_ENTRY)
})

test('stdio smoke: bundled server behaves identically', { skip: !existsSync(BUNDLE) && 'run npm run build first' }, async () => {
  await handshake(BUNDLE)
})
