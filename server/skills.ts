/**
 * WP31 Part A/C: scans `data/skills/` for Agent-Skills-format folders (a `SKILL.md` with
 * `name`/`description` front matter). Reads are confined to a skill's own folder —
 * `readSkillFile` blocks `..` and absolute paths before touching the filesystem.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { isSafeSkillRelativePath, parseSkillFrontMatter, SkillInfo } from '../shared/skills'

function dataDir() {
	return resolve(process.env.DATA_DIR ?? join(process.cwd(), 'data'))
}

export function skillsDir() {
	return join(dataDir(), 'skills')
}

/** All files in a folder, relative paths, skipping SKILL.md itself and dotfiles. */
function listFiles(dir: string, base = ''): string[] {
	let entries: string[]
	try {
		entries = readdirSync(dir)
	} catch {
		return []
	}
	const out: string[] = []
	for (const entry of entries) {
		if (entry.startsWith('.')) continue
		const full = join(dir, entry)
		const rel = base ? `${base}/${entry}` : entry
		const stat = statSync(full)
		if (stat.isDirectory()) out.push(...listFiles(full, rel))
		else if (rel !== 'SKILL.md') out.push(rel)
	}
	return out
}

/** Rescan the skills directory. Folders without a valid SKILL.md are skipped. */
export function scanSkills(): SkillInfo[] {
	const dir = skillsDir()
	if (!existsSync(dir)) return []
	const out: SkillInfo[] = []
	for (const id of readdirSync(dir)) {
		const folder = join(dir, id)
		if (!statSync(folder).isDirectory()) continue
		const skillMdPath = join(folder, 'SKILL.md')
		if (!existsSync(skillMdPath)) continue
		const front = parseSkillFrontMatter(readFileSync(skillMdPath, 'utf8'))
		if (!front) continue
		out.push({ id, ...front, files: listFiles(folder) })
	}
	return out.sort((a, b) => a.name.localeCompare(b.name))
}

export function readSkillMd(id: string): string {
	const folder = join(skillsDir(), id)
	const path = join(folder, 'SKILL.md')
	if (!existsSync(path)) throw new Error(`Unknown skill "${id}"`)
	return readFileSync(path, 'utf8')
}

/** Reads a file inside a skill's folder only. Throws on any attempt to escape it. */
export function readSkillFile(id: string, relativePath: string): string {
	if (!isSafeSkillRelativePath(relativePath)) throw new Error(`Invalid path "${relativePath}"`)
	const folder = resolve(join(skillsDir(), id))
	const target = resolve(join(folder, relativePath))
	if (target !== folder && !target.startsWith(folder + '/')) {
		throw new Error(`Path "${relativePath}" is outside the skill folder`)
	}
	if (!existsSync(target) || !statSync(target).isFile()) throw new Error(`File not found: ${relativePath}`)
	return readFileSync(target, 'utf8')
}
