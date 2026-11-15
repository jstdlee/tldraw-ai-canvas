import type { Plugin } from 'vite'

/** The Pyodide runtime files served at /pyodide/ (dev) and copied to dist/pyodide/ (build). */
export const PYODIDE_FILES: string[]

/** WP49: serve and bundle the Pyodide runtime so Python runs offline. */
export function pyodidePlugin(): Plugin
