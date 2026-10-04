import { describe, expect, it } from 'vitest'
import { formatSubnet, ipv4Type, splitSubnet, subnetInfo } from '../shared/ipTools'
import { parseCsv, runTextTool, sha256Hex, TEXT_TOOL_OPS } from '../shared/textTools'
import { cleanHost } from '../server/nettools'
import { randomValue } from '../shared/random'

describe('more text tools', () => {
	it('every listed tool runs', () => {
		for (const op of TEXT_TOOL_OPS) {
			const input = op.id.startsWith('json') || op.id === 'json'
				? '[{"a":1,"b":"x"},{"a":2}]'
				: op.id.startsWith('url')
					? 'https://ex.com/p?utm_source=a&id=2'
					: op.id === 'from_binary'
						? '01101000 01101001'
						: op.id === 'from_hex'
							? '68 69'
							: op.id === 'base64_decode'
								? 'aGk='
								: 'Hello World\nhello again, test@ex.com #tag'
			expect(() => runTextTool(op.id, input, '', '', 'other'), op.id).not.toThrow()
		}
	})
	it('case styles', () => {
		expect(runTextTool('camel', 'Hello big World')).toBe('helloBigWorld')
		expect(runTextTool('snake', 'helloBigWorld')).toBe('hello_big_world')
		expect(runTextTool('kebab', 'Hello Big_World')).toBe('hello-big-world')
		expect(runTextTool('pascal', 'hello big world')).toBe('HelloBigWorld')
		expect(runTextTool('sentence', 'HELLO. how ARE you?')).toBe('Hello. How are you?')
	})
	it('extracts and filters', () => {
		const text = 'mail a@b.co or x.y+z@mail.org, see https://a.com/x?q=1 and 10.0.0.1'
		expect(runTextTool('extract_emails', text)).toBe('a@b.co\nx.y+z@mail.org')
		expect(runTextTool('extract_urls', text)).toBe('https://a.com/x?q=1')
		expect(runTextTool('extract_ips', text)).toBe('10.0.0.1')
		expect(runTextTool('keep_lines', 'apple\nbanana\ncherry', 'an')).toBe('banana')
		expect(runTextTool('remove_lines', 'apple\nbanana\ncherry', '/^a/')).toBe('banana\ncherry')
	})
	it('wraps, cleans, encodes', () => {
		expect(runTextTool('wrap', 'one two three four five', '10')).toBe('one two\nthree four\nfive')
		expect(runTextTool('remove_line_breaks', 'a\n b\nc')).toBe('a b c')
		expect(runTextTool('remove_accents', 'café déjà')).toBe('cafe deja')
		expect(runTextTool('rot13', 'Hello')).toBe('Uryyb')
		expect(runTextTool('from_hex', runTextTool('to_hex', 'héllo'))).toBe('héllo')
		expect(runTextTool('from_binary', runTextTool('to_binary', 'ok'))).toBe('ok')
		expect(runTextTool('html_decode', runTextTool('html_encode', '<a href="x">&</a>'))).toBe('<a href="x">&</a>')
	})
	it('SHA-256 matches known vectors', () => {
		expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855')
		expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
		expect(sha256Hex('a'.repeat(1000))).toBe('41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3')
	})
	it('CSV / JSON / Markdown', () => {
		expect(parseCsv('a,b\n"x, y","he said ""hi"""\n')).toEqual([['a', 'b'], ['x, y', 'he said "hi"']])
		expect(JSON.parse(runTextTool('csv_to_json', 'name,age\nAnn,30'))).toEqual([{ name: 'Ann', age: '30' }])
		expect(runTextTool('json_to_csv', '[{"a":1,"b":"x,y"},{"a":2}]')).toBe('a,b\n1,"x,y"\n2,')
		expect(runTextTool('csv_to_markdown', 'a,b\n1,2')).toBe('| a | b |\n| --- | --- |\n| 1 | 2 |')
	})
	it('URLs and diff', () => {
		expect(runTextTool('url_clean', 'https://ex.com/p?utm_source=a&id=2&fbclid=z')).toBe('https://ex.com/p?id=2')
		expect(runTextTool('url_domain', 'https://www.example.org/x\nsub.test.com')).toBe('example.org\nsub.test.com')
		expect(runTextTool('diff', 'a\nb\nc', '', '', 'a\nc\nd')).toBe('  a\n- b\n  c\n+ d')
		expect(runTextTool('word_frequency', 'the cat the hat THE', '2')).toBe('the\t3\ncat\t1')
	})
})

describe('IP tools', () => {
	it('calculates subnets', () => {
		const s = subnetInfo('192.168.10.77/26')
		expect(s).toMatchObject({ network: '192.168.10.64', broadcast: '192.168.10.127', firstHost: '192.168.10.65', lastHost: '192.168.10.126', hosts: 62, netmask: '255.255.255.192' })
		expect(subnetInfo('10.1.2.3 255.255.0.0').cidr).toBe('10.1.0.0/16')
		expect(subnetInfo('10.0.0.5/31').hosts).toBe(2)
		expect(splitSubnet('10.0.0.0/24', 26)).toEqual(['10.0.0.0/26', '10.0.0.64/26', '10.0.0.128/26', '10.0.0.192/26'])
		expect(() => subnetInfo('300.1.1.1/24')).toThrow()
		expect(formatSubnet(s)).toContain('62 usable')
	})
	it('classifies addresses', () => {
		expect(ipv4Type('172.20.1.1')).toBe('private')
		expect(ipv4Type('8.8.8.8')).toBe('public')
		expect(ipv4Type('100.64.3.3')).toBe('carrier-grade NAT')
	})
	it('only accepts host names and IPs for system commands', () => {
		expect(cleanHost('https://example.com/path')).toBe('example.com')
		expect(cleanHost('1.1.1.1')).toBe('1.1.1.1')
		expect(cleanHost('::1')).toBe('::1')
		for (const bad of ['1.1.1.1; rm -rf /', '$(id)', '-oProxyCommand=x', 'a b', '`x`']) expect(() => cleanHost(bad)).toThrow()
	})
})

describe('random', () => {
	const seq = (values: number[]) => {
		let i = 0
		return () => values[i++ % values.length]
	}
	it('is deterministic for a given source', () => {
		expect(randomValue('number', '1', '10', '', seq([0]))).toBe('1')
		expect(randomValue('number', '1', '10', '', seq([0.999]))).toBe('10')
		expect(randomValue('number', '0.0', '1.0', '', seq([0.25]))).toBe('0.3')
		expect(randomValue('coin', '', '', '', seq([0.7]))).toBe('tails')
		expect(randomValue('pick', '2', '', 'a\nb\nc', seq([0, 0]))).toBe('a\nb')
		expect(randomValue('uuid', '', '', '')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
		expect(randomValue('shuffle', '', '', 'a\nb\nc').split('\n').sort()).toEqual(['a', 'b', 'c'])
	})
})
