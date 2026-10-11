import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defineConfig, devices } from '@playwright/test'

// WP25: local-only performance benchmark (`npm run test:perf`), never part of `npm run test:e2e`
// and never added to .github/. Same pattern as `playwright.config.ts` (WP20/WP24): its own ports
// (5189 web, 8799 API), never 5173/5174/8790 (the owner's dev session) or 5185/8795 (the e2e
// suite's), and a fresh temp DATA_DIR. One headless Chromium only (GPU/unified memory is shared).
const WEB_PORT = Number(process.env.E2E_WEB_PORT ?? 5189)
const API_PORT = Number(process.env.E2E_API_PORT ?? 8799)
const DATA_DIR = mkdtempSync(join(tmpdir(), 'tldraw-perf-'))

export default defineConfig({
	testDir: 'tests/perf',
	testMatch: /.*\.perf\.spec\.ts/,
	timeout: 120_000,
	fullyParallel: false,
	workers: 1,
	retries: 0,
	reporter: 'list',
	use: {
		baseURL: `http://127.0.0.1:${WEB_PORT}`,
		trace: 'off',
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
			// A production build measures real-world cost better than the dev server (no HMR
			// client, minified), but the dev server is simplest and still shows every effect
			// this WP targets (anchors/run-state atoms, culling, chart instances). See
			// `tests/perf/results.md` for the methodology actually used.
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
