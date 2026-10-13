import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { callMcpTool, closeAllMcpConnections, listMcpTools } from '../server/mcp'
import { McpServerConfig } from '../shared/mcpConfig'

const FIXTURE = join(__dirname, 'fixtures', 'fake-mcp-server.mjs')

const fakeServer: McpServerConfig = {
	id: 'fake',
	name: 'Fake MCP',
	transport: 'stdio',
	command: process.execPath,
	args: [FIXTURE],
	enabled: true,
}

describe('mcp: real client against a fake stdio server (no network)', () => {
	afterAll(async () => {
		await closeAllMcpConnections()
	})

	it('lists the fixture tools', async () => {
		const tools = await listMcpTools(fakeServer)
		const names = tools.map((t) => t.name).sort()
		expect(names).toEqual(['echo', 'fail'])
		expect(tools.find((t) => t.name === 'echo')?.description).toMatch(/[Ee]cho/)
	})

	it('calls a tool and gets its result', async () => {
		const result = await callMcpTool(fakeServer, 'echo', { text: 'hello' })
		expect(result.isError).toBe(false)
		expect(result.text).toBe('HELLO')
	})

	it('marks a failing tool as an error', async () => {
		const result = await callMcpTool(fakeServer, 'fail', {})
		expect(result.isError).toBe(true)
		expect(result.text).toBe('boom')
	})

	it('reuses the open connection on a second call (no second spawn needed)', async () => {
		const a = await callMcpTool(fakeServer, 'echo', { text: 'one' })
		const b = await callMcpTool(fakeServer, 'echo', { text: 'two' })
		expect(a.text).toBe('ONE')
		expect(b.text).toBe('TWO')
	})

	it('refuses a disabled server', async () => {
		await expect(listMcpTools({ ...fakeServer, enabled: false })).rejects.toThrow(/turned off/)
	})
})
