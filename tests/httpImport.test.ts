import { describe, expect, it } from 'vitest'
import { parseCurl, parseFetchCall, parseHttpImport, parseRawHttp } from '../shared/httpImport'

describe('parseCurl', () => {
	it('parses a simple GET', () => {
		const r = parseCurl('curl https://example.com/api/items?limit=10')
		expect(r.method).toBe('GET')
		expect(r.url).toBe('https://example.com/api/items')
		expect(r.query).toBe('limit=10')
	})

	it('parses -X, -H and -d, defaulting method to POST when there is data and no -X', () => {
		const r = parseCurl(
			`curl 'https://example.com/api/items' -H 'Content-Type: application/json' -H 'Accept: application/json' --data-raw '{"a":1}'`
		)
		expect(r.method).toBe('POST')
		expect(r.url).toBe('https://example.com/api/items')
		expect(r.headers['Content-Type']).toBe('application/json')
		expect(r.headers['Accept']).toBe('application/json')
		expect(r.body).toBe('{"a":1}')
	})

	it('honors an explicit -X over the data-implied method', () => {
		const r = parseCurl(`curl -X PUT https://example.com/api/items -d 'x=1'`)
		expect(r.method).toBe('PUT')
	})

	it('extracts a Bearer Authorization header into auth, and removes it from headers', () => {
		const r = parseCurl(`curl https://example.com -H 'Authorization: Bearer secret-token-123'`)
		expect(r.auth).toEqual({ kind: 'bearer', value: 'secret-token-123' })
		expect(r.headers['Authorization']).toBeUndefined()
	})

	it('-u user:pass becomes basic auth', () => {
		const r = parseCurl(`curl -u alice:s3cret https://example.com`)
		expect(r.auth).toEqual({ kind: 'basic', value: 'alice:s3cret' })
	})

	it('-b/--cookie becomes a Cookie header (not parsed further)', () => {
		const r = parseCurl(`curl https://example.com -b 'session=abc; theme=dark'`)
		expect(r.headers['Cookie']).toBe('session=abc; theme=dark')
	})

	it('ignores --compressed, -s, -L, -k and handles line continuations', () => {
		const r = parseCurl(`curl --compressed -s -L -k \\\n  https://example.com/x`)
		expect(r.url).toBe('https://example.com/x')
	})

	it('supports the --url and --request long forms, including --flag=value', () => {
		const r = parseCurl(`curl --request=DELETE --url=https://example.com/x`)
		expect(r.method).toBe('DELETE')
		expect(r.url).toBe('https://example.com/x')
	})

	it('throws when the command does not start with curl', () => {
		expect(() => parseCurl('wget https://example.com')).toThrow()
	})
})

describe('parseRawHttp', () => {
	it('parses a request line, Host header into the URL, headers and body', () => {
		const text = ['POST /api/items HTTP/1.1', 'Host: example.com', 'Content-Type: application/json', '', '{"a":1}'].join(
			'\n'
		)
		const r = parseRawHttp(text)
		expect(r.method).toBe('POST')
		expect(r.url).toBe('https://example.com/api/items')
		expect(r.headers['Content-Type']).toBe('application/json')
		expect(r.headers['Host']).toBeUndefined()
		expect(r.body).toBe('{"a":1}')
	})

	it('splits the query string out of the path', () => {
		const text = ['GET /search?q=cats&limit=5 HTTP/1.1', 'Host: example.com', ''].join('\n')
		const r = parseRawHttp(text)
		expect(r.url).toBe('https://example.com/search')
		expect(r.query).toBe('q=cats\nlimit=5')
	})

	it('extracts a Basic Authorization header', () => {
		const token = Buffer.from('alice:s3cret').toString('base64')
		const text = ['GET / HTTP/1.1', 'Host: example.com', `Authorization: Basic ${token}`, ''].join('\n')
		const r = parseRawHttp(text)
		expect(r.auth).toEqual({ kind: 'basic', value: 'alice:s3cret' })
		expect(r.headers['Authorization']).toBeUndefined()
	})

	it('throws without a request line', () => {
		expect(() => parseRawHttp('not a request\nHost: example.com\n')).toThrow()
	})

	it('throws without a Host header', () => {
		expect(() => parseRawHttp('GET / HTTP/1.1\n\n')).toThrow()
	})
})

describe('parseFetchCall', () => {
	it('parses a browser "Copy as fetch" snippet', () => {
		const text = `fetch("https://example.com/api/items?limit=10", {
  "headers": {
    "accept": "application/json",
    "authorization": "Bearer tok-abc"
  },
  "body": "{\\"a\\":1}",
  "method": "POST"
});`
		const r = parseFetchCall(text)
		expect(r.method).toBe('POST')
		expect(r.url).toBe('https://example.com/api/items')
		expect(r.query).toBe('limit=10')
		expect(r.headers['accept']).toBe('application/json')
		expect(r.headers['authorization']).toBeUndefined()
		expect(r.auth).toEqual({ kind: 'bearer', value: 'tok-abc' })
		expect(r.body).toBe('{"a":1}')
	})

	it('defaults to GET with no options object', () => {
		const r = parseFetchCall(`fetch('https://example.com/x')`)
		expect(r.method).toBe('GET')
		expect(r.url).toBe('https://example.com/x')
	})

	it('throws on something that is not a fetch call', () => {
		expect(() => parseFetchCall('curl https://example.com')).toThrow()
	})
})

describe('parseHttpImport (format detection)', () => {
	it('detects curl', () => {
		expect(parseHttpImport('curl https://example.com').url).toBe('https://example.com')
	})
	it('detects a raw HTTP request', () => {
		const text = 'GET / HTTP/1.1\nHost: example.com\n'
		expect(parseHttpImport(text).url).toBe('https://example.com/')
	})
	it('detects fetch(...)', () => {
		expect(parseHttpImport(`fetch("https://example.com")`).url).toBe('https://example.com')
	})
	it('throws a clear error for unrecognized text', () => {
		expect(() => parseHttpImport('hello, this is not a request')).toThrow(/recognize/i)
	})
	it('throws for empty input', () => {
		expect(() => parseHttpImport('   ')).toThrow()
	})
})
