// Bundle the Electron main process and the local server into dist-electron/.
// The web app itself is built by Vite into dist/.
import { build } from 'esbuild'

const common = {
	bundle: true,
	platform: 'node',
	target: 'node22',
	format: 'cjs',
	sourcemap: false,
	minify: false,
	logLevel: 'info',
}

await build({
	...common,
	entryPoints: ['server/index.ts'],
	outfile: 'dist-electron/server.cjs',
})

await build({
	...common,
	entryPoints: ['electron/main.ts'],
	outfile: 'dist-electron/main.cjs',
	external: ['electron', './server.cjs'],
})
