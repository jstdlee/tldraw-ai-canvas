import { createReadStream, copyFileSync, existsSync, mkdirSync, statSync } from 'fs'
import { createRequire } from 'module'
import path from 'path'

/**
 * WP49: offline Python. Serves the `pyodide` npm package's runtime files at `/pyodide/` in dev,
 * and copies them into `dist/pyodide/` on build, so the Code card loads Pyodide from the app's
 * own origin (the desktop app works with no network). Packages such as numpy are not in the npm
 * package; Pyodide still downloads those from its CDN on first use.
 */
export const PYODIDE_FILES = ['pyodide.js', 'pyodide.asm.js', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json']

const TYPES = {
	'.js': 'text/javascript',
	'.wasm': 'application/wasm',
	'.zip': 'application/zip',
	'.json': 'application/json',
}

function pyodideDir() {
	const require = createRequire(import.meta.url)
	return path.dirname(require.resolve('pyodide/package.json'))
}

/** @returns {import('vite').Plugin} */
export function pyodidePlugin() {
	let outDir = 'dist'
	return {
		name: 'pyodide-offline',
		configResolved(config) {
			outDir = path.resolve(config.root, config.build.outDir)
		},
		configureServer(server) {
			const dir = pyodideDir()
			server.middlewares.use('/pyodide', (req, res, next) => {
				const name = decodeURIComponent((req.url ?? '').split('?')[0].replace(/^\/+/, ''))
				if (!PYODIDE_FILES.includes(name)) return next()
				const file = path.join(dir, name)
				res.setHeader('Content-Type', TYPES[path.extname(name)] ?? 'application/octet-stream')
				res.setHeader('Content-Length', String(statSync(file).size))
				res.setHeader('Cache-Control', 'public, max-age=3600')
				createReadStream(file).pipe(res)
			})
		},
		writeBundle() {
			const dir = pyodideDir()
			const target = path.join(outDir, 'pyodide')
			mkdirSync(target, { recursive: true })
			for (const name of PYODIDE_FILES) {
				const from = path.join(dir, name)
				if (existsSync(from)) copyFileSync(from, path.join(target, name))
			}
		},
	}
}
