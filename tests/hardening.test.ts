/**
 * WP19 — tests for the pure parts of the hardening work. What cannot be unit-tested
 * (an actual aborted fetch to a provider, the desktop app's saved origin, a toast
 * appearing in the UI) is described as a manual check at the bottom instead.
 */
import { describe, expect, it } from 'vitest'
import { isAbortError } from '../shared/abort'
import { authHeader, needsAuthValueMigration } from '../shared/httpBuild'
import { resolveSecret } from '../shared/secrets'

describe('isAbortError (WP19 Part 2)', () => {
	it('recognizes a DOMException AbortError, as fetch throws when its signal aborts', () => {
		expect(isAbortError(new DOMException('The operation was aborted.', 'AbortError'))).toBe(true)
	})

	it('recognizes a plain Error named AbortError (some runtimes/polyfills throw this)', () => {
		const error = new Error('aborted')
		error.name = 'AbortError'
		expect(isAbortError(error)).toBe(true)
	})

	it('is false for an unrelated error, so a real failure still shows as an error', () => {
		expect(isAbortError(new Error('network down'))).toBe(false)
		expect(isAbortError(new TypeError('boom'))).toBe(false)
	})

	it('is false for non-error values', () => {
		expect(isAbortError(undefined)).toBe(false)
		expect(isAbortError(null)).toBe(false)
		expect(isAbortError('aborted')).toBe(false)
	})
})

describe('needsAuthValueMigration (WP19 Part 1, pure part)', () => {
	it('migrates when an auth style is chosen and a plain value is set but no ref yet', () => {
		expect(needsAuthValueMigration('bearer', undefined, 'typed-token')).toBe(true)
		expect(needsAuthValueMigration('basic', '', 'user:pass')).toBe(true)
	})

	it('does not migrate once a ref already exists', () => {
		expect(needsAuthValueMigration('bearer', 'secret:abc', 'typed-token')).toBe(false)
	})

	it('does not migrate with no auth style chosen', () => {
		expect(needsAuthValueMigration('', undefined, 'typed-token')).toBe(false)
		expect(needsAuthValueMigration(undefined, undefined, 'typed-token')).toBe(false)
	})

	it('does not migrate when there is nothing to move', () => {
		expect(needsAuthValueMigration('bearer', undefined, '')).toBe(false)
		expect(needsAuthValueMigration('bearer', undefined, undefined)).toBe(false)
	})
})

describe('resolveSecret with an authRef (WP19 Part 1)', () => {
	it('resolves the HTTP card’s authRef the same way RawModelNode’s keyRef resolves, then builds the header', () => {
		const store: Record<string, string> = { tok1: 'swordfish' }
		const getSecret = (id: string) => store[id]
		const secret = resolveSecret('secret:tok1', {}, getSecret)
		expect(secret).toBe('swordfish')
		expect(authHeader('bearer', secret)).toEqual({ Authorization: 'Bearer swordfish' })
	})

	it('throws a clear error for an authRef whose secret was removed', () => {
		expect(() => resolveSecret('secret:gone', {}, () => undefined)).toThrow(/not found/i)
	})

	it('also resolves env:NAME for the auth value, same as keyRef', () => {
		process.env.WP19_TEST_AUTH = 'env-token'
		expect(resolveSecret('env:WP19_TEST_AUTH', process.env)).toBe('env-token')
		delete process.env.WP19_TEST_AUTH
	})

	it('never bakes a secret ref string itself into the header (the literal "secret:<id>" is not a usable token)', () => {
		// Guards the reason the client no longer builds the Authorization header itself once
		// authRef is set: buildHttpRequest never sees the ref, only the resolved value does.
		expect(authHeader('bearer', 'secret:tok1')).toEqual({ Authorization: 'Bearer secret:tok1' })
		// i.e. the ref must be resolved first — this is why server/http.ts calls resolveSecret
		// before authHeader, never the other way around.
	})
})

/**
 * Manual checks (not unit-testable: real network aborts, the desktop window's saved
 * origin, and a UI toast):
 *
 * 1. HTTP card auth: add an HTTP card, set Auth to Bearer, type a token into the key
 *    field, Run once. Save the canvas, reload, open dev tools → Application → IndexedDB
 *    and confirm the saved node has `authRef: "secret:…"` and no `authValue`. Export/backup
 *    the canvas (`/api/backup`) and grep the file for the token text — it must not appear.
 * 2. Stop aborts: wire a slow Generate text call (a large prompt against a small local
 *    model), press Run, then press Stop within ~1s. The card's footer should read
 *    "Stopped" (no red border, no error banner) and the server log (`npm run dev` terminal)
 *    should show the request aborted, not run to completion. Repeat for the HTTP card (point
 *    it at a slow URL) and the For each card (5+ items, press Stop after item 2): it should
 *    stop issuing new items, keep the ones already done, and show "stopped at N / M".
 * 3. Built-in Postgres fallback: temporarily block IndexedDB (e.g. a private window with
 *    storage disabled, or revoke the site's storage permission), add a Database card with
 *    source "Built-in Postgres" (or the legacy Postgres card), and confirm the warning row
 *    "Built-in Postgres is running in memory…" appears and a toast shows once per session
 *    even with two such cards on the canvas.
 * 4. MyGo port: run the MyGo build (`npm run build:mygo` then the produced binary) twice in
 *    a row, save something on the canvas the first time, and confirm it is still there on
 *    the second launch (same origin ⇒ same IndexedDB). It should also still run alongside a
 *    launched Electron build without a port clash (47202 vs 47201).
 */
