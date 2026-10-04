/** Pure IPv4/IPv6 helpers: subnet calculator, address info. */

export function isIPv4(s: string): boolean {
	const parts = s.trim().split('.')
	return parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255)
}

export function isIPv6(s: string): boolean {
	const v = s.trim()
	if (!v.includes(':')) return false
	try {
		new URL(`http://[${v}]/`)
		return true
	} catch {
		return false
	}
}

export function ipv4ToInt(ip: string): number {
	return ip.split('.').reduce((acc, p) => ((acc << 8) | Number(p)) >>> 0, 0) >>> 0
}

export function intToIpv4(n: number): string {
	return [24, 16, 8, 0].map((s) => (n >>> s) & 255).join('.')
}

function maskFromPrefix(prefix: number): number {
	return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
}

function prefixFromMask(mask: string): number | null {
	if (!isIPv4(mask)) return null
	const n = ipv4ToInt(mask)
	const bits = n.toString(2).padStart(32, '0')
	return /^1*0*$/.test(bits) ? bits.indexOf('0') === -1 ? 32 : bits.indexOf('0') : null
}

export interface SubnetInfo {
	address: string
	cidr: string
	netmask: string
	wildcard: string
	network: string
	broadcast: string
	firstHost: string
	lastHost: string
	hosts: number
	prefix: number
	class: string
	type: string
	binaryMask: string
}

/** Accepts "192.168.1.10/24", "192.168.1.10 255.255.255.0" or a bare IP (/32). */
export function subnetInfo(input: string): SubnetInfo {
	const text = input.trim()
	const m = text.match(/^(\d+\.\d+\.\d+\.\d+)\s*(?:\/\s*(\d{1,2})|\s+(\d+\.\d+\.\d+\.\d+))?$/)
	if (!m || !isIPv4(m[1])) throw new Error('Use an IPv4 address with a prefix, e.g. 192.168.1.10/24')
	const prefix = m[2] != null ? Number(m[2]) : m[3] ? prefixFromMask(m[3]) : 32
	if (prefix == null || prefix < 0 || prefix > 32) throw new Error('Invalid prefix or netmask')
	const ip = ipv4ToInt(m[1])
	const mask = maskFromPrefix(prefix)
	const network = (ip & mask) >>> 0
	const broadcast = (network | (~mask >>> 0)) >>> 0
	const hosts = prefix >= 31 ? (prefix === 32 ? 1 : 2) : broadcast - network - 1
	const first = prefix >= 31 ? network : network + 1
	const last = prefix >= 31 ? broadcast : broadcast - 1
	const firstOctet = ip >>> 24
	const klass = firstOctet < 128 ? 'A' : firstOctet < 192 ? 'B' : firstOctet < 224 ? 'C' : firstOctet < 240 ? 'D (multicast)' : 'E (reserved)'
	return {
		address: m[1],
		cidr: `${intToIpv4(network)}/${prefix}`,
		netmask: intToIpv4(mask),
		wildcard: intToIpv4(~mask >>> 0),
		network: intToIpv4(network),
		broadcast: intToIpv4(broadcast),
		firstHost: intToIpv4(first),
		lastHost: intToIpv4(last),
		hosts,
		prefix,
		class: klass,
		type: ipv4Type(m[1]),
		binaryMask: mask.toString(2).padStart(32, '0').replace(/(.{8})(?!$)/g, '$1.'),
	}
}

export function ipv4Type(ip: string): string {
	const n = ipv4ToInt(ip)
	const inRange = (cidr: string) => {
		const [base, p] = cidr.split('/')
		const mask = maskFromPrefix(Number(p))
		return ((n & mask) >>> 0) === ((ipv4ToInt(base) & mask) >>> 0)
	}
	if (inRange('10.0.0.0/8') || inRange('172.16.0.0/12') || inRange('192.168.0.0/16')) return 'private'
	if (inRange('127.0.0.0/8')) return 'loopback'
	if (inRange('169.254.0.0/16')) return 'link-local'
	if (inRange('100.64.0.0/10')) return 'carrier-grade NAT'
	if (inRange('224.0.0.0/4')) return 'multicast'
	if (inRange('0.0.0.0/8')) return 'this network'
	if (inRange('240.0.0.0/4')) return 'reserved'
	return 'public'
}

/** Split a network into equal smaller subnets, e.g. ("10.0.0.0/24", 26). */
export function splitSubnet(cidr: string, newPrefix: number, limit = 256): string[] {
	const info = subnetInfo(cidr)
	if (newPrefix < info.prefix || newPrefix > 32) throw new Error(`New prefix must be between ${info.prefix} and 32`)
	const count = 2 ** (newPrefix - info.prefix)
	const size = 2 ** (32 - newPrefix)
	const start = ipv4ToInt(info.network)
	return Array.from({ length: Math.min(count, limit) }, (_, i) => `${intToIpv4(start + i * size)}/${newPrefix}`)
}

export function formatSubnet(info: SubnetInfo): string {
	return [
		`Address     ${info.address}  (${info.type}, class ${info.class})`,
		`Network     ${info.cidr}`,
		`Netmask     ${info.netmask}  = /${info.prefix}`,
		`Wildcard    ${info.wildcard}`,
		`Broadcast   ${info.broadcast}`,
		`Hosts       ${info.firstHost} – ${info.lastHost}  (${info.hosts.toLocaleString('en-US')} usable)`,
		`Mask bits   ${info.binaryMask}`,
	].join('\n')
}
