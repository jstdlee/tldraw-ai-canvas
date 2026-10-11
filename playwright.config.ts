import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineConfig, devices } from '@playwright/test'

// Local-only E2E suite (WP20). Never added to .github/ — run by hand with `npm run test:e2e`.
// Own ports (5185 web, 8795 API), never 5173/5174/8790 (the owner's dev session), and a fresh
// temp DATA_DIR so these tests never touch real saved canvases or config.
const WEB_PORT = 5185
const API_PORT = 8795
const DATA_DIR = mkdtempSync(join(tmpdir(), 'tldraw-e2e-'))

export default defineConfig({
	testDir: 'tests/e2e',
	timeout: 30_000,
	fullyParallel: false,
	workers: 1,
	retries: 0,
	reporter: 'list',
	use: {
		baseURL: `http://127.0.0.1:${WEB_PORT}`,
		trace: 'retain-on-failure',
		viewport: { width: 1400, height: 900 },
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	webServer: [
		{
			command: `${join('node_modules', '.bin', 'tsx')} watch --clear-screen=false server/index.ts`,
			port: API_PORT,
			env: { API_PORT: String(API_PORT), DATA_DIR, NODE_ENV: 'test' },
			reuseExistingServer: false,
			timeout: 30_000,
			stdout: 'pipe',
			stderr: 'pipe',
		},
		{
			command: `${join('node_modules', '.bin', 'vite')} --port ${WEB_PORT} --strictPort`,
			port: WEB_PORT,
			env: { API_PORT: String(API_PORT) },
			reuseExistingServer: false,
			timeout: 30_000,
			stdout: 'pipe',
			stderr: 'pipe',
		},
	],
})
