import { fileURLToPath } from 'url'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { zodLocalePlugin } from './scripts/vite-zod-locale-plugin.js'

const API = `http://127.0.0.1:${process.env.API_PORT ?? 8790}`

export default defineConfig({
	plugins: [
		zodLocalePlugin(fileURLToPath(new URL('./scripts/zod-locales-shim.js', import.meta.url))),
		react(),
	],
	// @tldraw/assets imports its files with ?url; let Vite handle them, not the optimizer.
	optimizeDeps: { exclude: ['@tldraw/assets'] },
	server: {
		host: '127.0.0.1',
		port: 5173,
		// The Node server (server/index.ts) answers the AI and image routes.
		proxy: { '/api': API, '/stream': API },
	},
})
