import { execFile } from 'node:child_process'
import dns from 'node:dns/promises'
import net from 'node:net'
import os from 'node:os'
import { formatSubnet, isIPv4, isIPv6, ipv4Type, splitSubnet, subnetInfo } from '../shared/ipTools'
import { ConfigError } from './config'

/**
 * Network tools for the "Network tools" node. Commands run with execFile
 * (no shell), a fixed argument list and a time limit; the target must look
 * like a host name or an IP address.
 */

export type NetTool =
	| 'ping'
	| 'traceroute'
	| 'dig'
	| 'dns'
	| 'reverse_dns'
	| 'port'
	| 'whois'
	| 'http_headers'
	| 'my_ips'
	| 'subnet'
	| 'subnet_split'
	| 'ip_info'

export const NET_TOOLS: NetTool[] = [
	'ping',
	'traceroute',
	'dig',
	'dns',
	'reverse_dns',
	'port',
	'whois',
	'http_headers',
	'my_ips',
	'subnet',
	'subnet_split',
	'ip_info',
]

const HOST_RE = /^(?=.{1,253}$)([a-zA-Z0-9_]([a-zA-Z0-9_-]{0,61}[a-zA-Z0-9])?)(\.[a-zA-Z0-9_]([a-zA-Z0-9_-]{0,61}[a-zA-Z0-9])?)*\.?$/
const DNS_TYPES = ['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME', 'SOA', 'CAA', 'SRV', 'PTR', 'ANY']

/** Accept a host name, an IP, or a URL (its host is used). */
export function cleanHost(input: string): string {
	let host = (input ?? '').trim()
	if (/^[a-z]+:\/\//i.test(host)) host = new URL(host).hostname
	host = host.replace(/^\[|\]$/g, '')
	if (isIPv4(host) || isIPv6(host) || HOST_RE.test(host)) return host
	throw new ConfigError(`Not a host name or IP address: ${input}`)
}

function run(cmd: string, args: string[], timeoutMs: number): Promise<string> {
	return new Promise((resolve) => {
		execFile(cmd, args, { timeout: timeoutMs, maxBuffer: 1024 * 1024 }, (err, stdout, stderr) => {
			const out = `${stdout}${stderr ? `\n${stderr}` : ''}`.trim()
			if (err && !out) {
				const e = err as NodeJS.ErrnoException & { killed?: boolean }
				resolve(e.code === 'ENOENT' ? `${cmd} is not installed on this machine.` : e.killed ? `${cmd} timed out.` : e.message)
			} else resolve(out)
		})
	})
}

async function commandExists(cmd: string) {
	const out = await run('sh', ['-c', `command -v ${cmd}`], 3000)
	return out.startsWith('/')
}

function tcpCheck(host: string, port: number, timeoutMs = 5000): Promise<string> {
	return new Promise((resolve) => {
		const started = Date.now()
		const socket = net.connect({ host, port })
		const done = (msg: string) => {
			socket.destroy()
			resolve(msg)
		}
		socket.setTimeout(timeoutMs, () => done(`${host}:${port} — no answer within ${timeoutMs / 1000}s (filtered or down)`))
		socket.on('connect', () => done(`${host}:${port} — OPEN (connected in ${Date.now() - started} ms)`))
		socket.on('error', (e: NodeJS.ErrnoException) =>
			done(`${host}:${port} — ${e.code === 'ECONNREFUSED' ? 'CLOSED (refused)' : e.code ?? e.message}`)
		)
	})
}

function whoisQuery(server: string, query: string): Promise<string> {
	return new Promise((resolve, reject) => {
		let data = ''
		const socket = net.connect({ host: server, port: 43 })
		socket.setTimeout(10_000, () => {
			socket.destroy()
			reject(new Error(`WHOIS server ${server} timed out`))
		})
		socket.on('connect', () => socket.write(`${query}\r\n`))
		socket.on('data', (chunk) => (data += chunk.toString('utf8')))
		socket.on('end', () => resolve(data))
		socket.on('error', reject)
	})
}

async function whois(target: string): Promise<string> {
	// Ask IANA which registry is responsible, then ask that registry.
	const iana = await whoisQuery('whois.iana.org', target)
	const refer = iana.match(/^(?:refer|whois):\s*(\S+)/im)?.[1]
	if (!refer) return iana.trim()
	const answer = await whoisQuery(refer, target)
	return `[${refer}]\n${answer.trim()}`
}

async function httpHeaders(url: string): Promise<string> {
	const target = /^https?:\/\//i.test(url) ? url : `https://${url}`
	const lines: string[] = []
	let current = target
	for (let hop = 0; hop < 10; hop++) {
		const res = await fetch(current, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(15_000) })
		lines.push(`${res.status} ${res.statusText}  ${current}`)
		res.headers.forEach((v, k) => lines.push(`  ${k}: ${v}`))
		const next = res.headers.get('location')
		if (res.status >= 300 && res.status < 400 && next) {
			current = new URL(next, current).toString()
			lines.push('')
			continue
		}
		break
	}
	return lines.join('\n')
}

function myIps(): string {
	const lines: string[] = [`Host name: ${os.hostname()}`]
	for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
		for (const a of addrs ?? []) {
			lines.push(`${name.padEnd(12)} ${a.family.padEnd(5)} ${a.cidr ?? a.address}${a.internal ? '  (internal)' : ''}  ${a.mac}`)
		}
	}
	return lines.join('\n')
}

export async function runNetTool(tool: NetTool, target: string, option = ''): Promise<string> {
	switch (tool) {
		case 'ping': {
			const host = cleanHost(target)
			const count = Math.min(10, Math.max(1, Number(option) || 4))
			return run('ping', ['-c', String(count), '-W', '3', host], (count + 5) * 1000)
		}
		case 'traceroute': {
			const host = cleanHost(target)
			if (await commandExists('traceroute')) return run('traceroute', ['-w', '2', '-q', '1', '-m', '20', host], 60_000)
			if (await commandExists('tracepath')) return run('tracepath', ['-m', '20', host], 60_000)
			return run('mtr', ['--report', '--report-cycles', '1', '-n', host], 60_000)
		}
		case 'dig': {
			const host = cleanHost(target)
			const type = (option || 'A').toUpperCase()
			if (!DNS_TYPES.includes(type)) throw new ConfigError(`Record type must be one of ${DNS_TYPES.join(', ')}`)
			if (await commandExists('dig')) return run('dig', ['+noall', '+answer', '+authority', '+stats', host, type], 15_000)
			return runNetTool('dns', host, type)
		}
		case 'dns': {
			const host = cleanHost(target)
			const types = option ? [option.toUpperCase()] : ['A', 'AAAA', 'MX', 'NS', 'TXT', 'CNAME']
			const out: string[] = []
			for (const type of types) {
				try {
					const records = await dns.resolve(host, type as 'A')
					for (const r of records) out.push(`${type.padEnd(5)} ${typeof r === 'string' ? r : JSON.stringify(r)}`)
				} catch (e) {
					const code = (e as NodeJS.ErrnoException).code
					if (types.length === 1) out.push(`${type}: ${code === 'ENODATA' ? 'no records' : code}`)
				}
			}
			return out.join('\n') || 'No records found'
		}
		case 'reverse_dns': {
			const ip = target.trim()
			if (!isIPv4(ip) && !isIPv6(ip)) throw new ConfigError('Reverse DNS needs an IP address')
			try {
				return (await dns.reverse(ip)).join('\n')
			} catch (e) {
				return `No PTR record (${(e as NodeJS.ErrnoException).code})`
			}
		}
		case 'port': {
			const host = cleanHost(target)
			const ports = (option || '80,443')
				.split(/[\s,]+/)
				.map(Number)
				.filter((p) => Number.isInteger(p) && p > 0 && p < 65536)
				.slice(0, 20)
			if (!ports.length) throw new ConfigError('Give ports, e.g. 22,80,443')
			return (await Promise.all(ports.map((p) => tcpCheck(host, p)))).join('\n')
		}
		case 'whois':
			return whois(cleanHost(target))
		case 'http_headers':
			return httpHeaders(target.trim())
		case 'my_ips':
			return myIps()
		case 'subnet':
			return formatSubnet(subnetInfo(target))
		case 'subnet_split':
			return splitSubnet(target, Number(option)).join('\n')
		case 'ip_info': {
			const ip = target.trim()
			if (isIPv4(ip)) {
				const n = ip.split('.').map(Number)
				return [
					`IPv4 ${ip} — ${ipv4Type(ip)}`,
					`Integer  ${((n[0] << 24) | (n[1] << 16) | (n[2] << 8) | n[3]) >>> 0}`,
					`Hex      ${n.map((x) => x.toString(16).padStart(2, '0')).join('')}`,
					`Binary   ${n.map((x) => x.toString(2).padStart(8, '0')).join('.')}`,
					`PTR name ${[...n].reverse().join('.')}.in-addr.arpa`,
				].join('\n')
			}
			if (isIPv6(ip)) return `IPv6 ${ip}`
			throw new ConfigError('Give an IP address')
		}
	}
}
