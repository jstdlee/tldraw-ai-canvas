// A tiny MCP server over stdio, used by server/mcp.test.ts to exercise the real client
// without calling any real external service. One tool: `echo`, which returns its `text`
// argument uppercased, and a `fail` tool that always errors (to test error handling).
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const server = new McpServer({ name: 'fake-mcp-fixture', version: '1.0.0' })

server.registerTool(
	'echo',
	{
		description: 'Echoes text back, uppercased',
		inputSchema: { text: z.string() },
	},
	async ({ text }) => ({ content: [{ type: 'text', text: String(text).toUpperCase() }] })
)

server.registerTool(
	'fail',
	{ description: 'Always fails', inputSchema: {} },
	async () => ({ content: [{ type: 'text', text: 'boom' }], isError: true })
)

await server.connect(new StdioServerTransport())
