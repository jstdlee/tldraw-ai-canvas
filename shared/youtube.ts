/** YouTube links become embed links so the video plays inside the node. */

const HOSTS = new Set([
	'youtube.com',
	'www.youtube.com',
	'm.youtube.com',
	'music.youtube.com',
	'youtube-nocookie.com',
	'www.youtube-nocookie.com',
	'youtu.be',
	'www.youtu.be',
])

const ID = /^[\w-]{6,20}$/

function idFromPath(path: string, short: boolean): string | null {
	const parts = path.split('/').filter(Boolean)
	if (!parts.length) return null
	if (['embed', 'shorts', 'live', 'v'].includes(parts[0])) return parts[1] && ID.test(parts[1]) ? parts[1] : null
	return short && parts.length === 1 && ID.test(parts[0]) ? parts[0] : null
}

/** The video id of a YouTube link, or null. */
export function youtubeId(value: string): string | null {
	const text = value.trim()
	if (!text) return null
	let url: URL
	try {
		url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`)
	} catch {
		return null
	}
	const host = url.hostname.toLowerCase()
	if (!HOSTS.has(host)) return null
	const direct = url.searchParams.get('v')
	if (direct && ID.test(direct)) return direct
	return idFromPath(url.pathname, host.endsWith('youtu.be'))
}

/** The embed address of a YouTube link, or null when it is not one. */
export function youtubeEmbed(value: string): string | null {
	const id = youtubeId(value)
	return id ? `https://www.youtube-nocookie.com/embed/${id}` : null
}
