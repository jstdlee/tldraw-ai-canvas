import { describe, expect, it } from 'vitest'
import { McpConfig, validateMcpConfig, validateMcpServer } from '../shared/mcpConfig'

describe('mcpConfig: validation', () => {
	it('accepts a valid stdio server', () => {
		expect(
			validateMcpServer({
				id: 'a',
				name: 'A',
				transport: 'stdio',
				command: 'node',
				args: ['server.js'],
				env: { TOKEN: 'secret:abc' },
				enabled: true,
			})
		).toBeNull()
	})

	it('accepts a valid http server', () => {
		expect(
			validateMcpServer({
				id: 'b',
				name: 'B',
				transport: 'http',
				url: 'https://example.com/mcp',
				headers: { Authorization: 'secret:xyz' },
				enabled: true,
			})
		).toBeNull()
	})

	it('rejects a missing command for stdio', () => {
		expect(validateMcpServer({ id: 'a', name: 'A', transport: 'stdio', enabled: true })).toMatch(/command/)
	})

	it('rejects a non-http(s) URL', () => {
		expect(
			validateMcpServer({ id: 'b', name: 'B', transport: 'http', url: 'ftp://x', enabled: true })
		).toMatch(/http/)
	})

	it('rejects an unknown transport', () => {
		expect(validateMcpServer({ id: 'c', name: 'C', transport: 'websocket', enabled: true })).toMatch(/transport/)
	})

	it('rejects duplicate ids', () => {
		const config: McpConfig = [
			{ id: 'a', name: 'A', transport: 'stdio', command: 'node', enabled: true },
			{ id: 'a', name: 'A2', transport: 'stdio', command: 'node', enabled: true },
		]
		expect(() => validateMcpConfig(config)).toThrow(/Duplicate/)
	})

	it('rejects a non-array config', () => {
		expect(() => validateMcpConfig({})).toThrow(/list/)
	})

	it('passes a valid config through unchanged', () => {
		const config: McpConfig = [{ id: 'a', name: 'A', transport: 'stdio', command: 'node', enabled: true }]
		expect(validateMcpConfig(config)).toEqual(config)
	})

	it('rejects a raw literal value for a secret-looking HTTP header', () => {
		const problem = validateMcpServer({
			id: 'b',
			name: 'B',
			transport: 'http',
			url: 'https://example.com/mcp',
			headers: { Authorization: 'Bearer sk-raw-key-123' },
			enabled: true,
		})
		expect(problem).toMatch(/Authorization/)
		expect(problem).toMatch(/secret:|env:/)
	})

	it('accepts a secret: or env: ref for a secret-looking header', () => {
		expect(
			validateMcpServer({
				id: 'b',
				name: 'B',
				transport: 'http',
				url: 'https://example.com/mcp',
				headers: { Authorization: 'secret:abc123', 'X-Api-Key': 'env:MY_API_KEY' },
				enabled: true,
			})
		).toBeNull()
	})

	it('rejects a raw literal value for a secret-looking env var (stdio)', () => {
		const problem = validateMcpServer({
			id: 'a',
			name: 'A',
			transport: 'stdio',
			command: 'node',
			env: { API_TOKEN: 'raw-token-value' },
			enabled: true,
		})
		expect(problem).toMatch(/API_TOKEN/)
	})

	it('a non-secret-looking header may hold a plain value', () => {
		expect(
			validateMcpServer({
				id: 'b',
				name: 'B',
				transport: 'http',
				url: 'https://example.com/mcp',
				headers: { 'X-Client-Name': 'oh-my-tldraw' },
				enabled: true,
			})
		).toBeNull()
	})
})
