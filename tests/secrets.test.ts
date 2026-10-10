import { mkdtempSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveSecret } from '../shared/secrets'

const dataDir = mkdtempSync(join(tmpdir(), 'ai-canvas-secrets-'))
process.env.DATA_DIR = dataDir

describe('resolveSecret', () => {
	it('reads env:NAME from the environment', () => {
		process.env.MY_TEST_KEY = 'shh'
		expect(resolveSecret('env:MY_TEST_KEY', process.env)).toBe('shh')
		delete process.env.MY_TEST_KEY
	})

	it('throws a clear error when the env var is not set', () => {
		expect(() => resolveSecret('env:NOPE_NOT_SET', {})).toThrow(/NOPE_NOT_SET/)
	})

	it('resolves secret:<id> with the getSecret lookup', () => {
		const value = resolveSecret('secret:abc123', {}, (id) => (id === 'abc123' ? 'the-real-key' : undefined))
		expect(value).toBe('the-real-key')
	})

	it('throws when the secret id is unknown', () => {
		expect(() => resolveSecret('secret:missing', {}, () => undefined)).toThrow(/not found/i)
	})

	it('returns a plain value unchanged', () => {
		expect(resolveSecret('a-literal-key', {})).toBe('a-literal-key')
	})

	it('returns an empty string for undefined/empty input', () => {
		expect(resolveSecret(undefined, {})).toBe('')
		expect(resolveSecret('  ', {})).toBe('')
	})
})

describe('server secret store', () => {
	it('saves a value and reads it back only through the id, never listing values', async () => {
		const { createSecret, getSecretValue, deleteSecret } = await import('../server/secretsStore')
		const id = createSecret('top-secret-value')
		expect(typeof id).toBe('string')
		expect(id.length).toBeGreaterThan(0)
		expect(getSecretValue(id)).toBe('top-secret-value')
		deleteSecret(id)
		expect(getSecretValue(id)).toBeUndefined()
	})

	it('resolveSecret works end to end with the real store', async () => {
		const { createSecret, getSecretValue } = await import('../server/secretsStore')
		const id = createSecret('end-to-end-key')
		expect(resolveSecret(`secret:${id}`, {}, getSecretValue)).toBe('end-to-end-key')
	})

	it('getSecretValue returns undefined for an unknown id', async () => {
		const { getSecretValue } = await import('../server/secretsStore')
		expect(getSecretValue('never-created')).toBeUndefined()
	})

	it('writes the store file with mode 0600', async () => {
		const { createSecret } = await import('../server/secretsStore')
		createSecret('permission-check')
		const mode = statSync(join(dataDir, 'secrets.json')).mode & 0o777
		expect(mode).toBe(0o600)
	})
})
