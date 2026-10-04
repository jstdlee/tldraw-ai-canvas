/** Random node logic (pure; `rand` is injectable for tests). */

export const RANDOM_MODES = [
	{ id: 'number', label: 'Number (min – max)' },
	{ id: 'pick', label: 'Pick from list' },
	{ id: 'shuffle', label: 'Shuffle lines' },
	{ id: 'coin', label: 'Coin flip' },
	{ id: 'dice', label: 'Dice (sides)' },
	{ id: 'uuid', label: 'UUID' },
	{ id: 'password', label: 'Password (length)' },
	{ id: 'color', label: 'Colour (hex)' },
] as const

/** Pure: one random result. `rand` returns [0, 1). */
export function randomValue(
	mode: string,
	a: string,
	b: string,
	list: string,
	rand: () => number = Math.random
): string {
	const int = (min: number, max: number) => Math.floor(rand() * (max - min + 1)) + min
	switch (mode) {
		case 'number': {
			const min = Number(a || 0)
			const max = Number(b || 100)
			const decimals = /\./.test(a + b) ? Math.max((a.split('.')[1] ?? '').length, (b.split('.')[1] ?? '').length) : 0
			return decimals ? (min + rand() * (max - min)).toFixed(decimals) : String(int(Math.ceil(min), Math.floor(max)))
		}
		case 'pick': {
			const items = list.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)
			const count = Math.min(items.length, Math.max(1, Number(a) || 1))
			const pool = [...items]
			const picked: string[] = []
			while (picked.length < count && pool.length) picked.push(pool.splice(int(0, pool.length - 1), 1)[0])
			return picked.join('\n')
		}
		case 'shuffle': {
			const items = list.split(/\r?\n/)
			for (let i = items.length - 1; i > 0; i--) {
				const j = int(0, i)
				;[items[i], items[j]] = [items[j], items[i]]
			}
			return items.join('\n')
		}
		case 'coin':
			return rand() < 0.5 ? 'heads' : 'tails'
		case 'dice':
			return String(int(1, Math.max(2, Number(a) || 6)))
		case 'uuid':
			return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
				const r = int(0, 15)
				return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
			})
		case 'password': {
			const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%&*-_'
			return Array.from({ length: Math.min(128, Math.max(4, Number(a) || 16)) }, () => chars[int(0, chars.length - 1)]).join('')
		}
		case 'color':
			return '#' + int(0, 0xffffff).toString(16).padStart(6, '0')
		default:
			return ''
	}
}
