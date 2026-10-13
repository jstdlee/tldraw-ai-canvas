/**
 * WP31 Part A/C: skills are folders under `data/skills/` with a `SKILL.md` file that
 * starts with YAML-ish front matter (`name`, `description`) — the Agent Skills format.
 * Parsing is pure/testable here; the filesystem scan (`server/skills.ts`) uses it.
 */

export interface SkillFrontMatter {
	name: string
	description: string
}

export interface SkillInfo extends SkillFrontMatter {
	/** The folder name under the skills directory. */
	id: string
	/** Other files in the folder, relative paths (for `read_skill_file`). */
	files: string[]
}

/**
 * Parse `---\nkey: value\n...\n---` front matter from the start of a SKILL.md. Only
 * simple `key: value` lines are understood (no nested YAML) — enough for `name` +
 * `description`, which is all the Agent Skills format requires of us here.
 */
export function parseSkillFrontMatter(markdown: string): SkillFrontMatter | null {
	const match = /^---\r?\n([\s\S]*?)\r?\n---/.exec(markdown)
	if (!match) return null
	const fields: Record<string, string> = {}
	for (const line of match[1].split(/\r?\n/)) {
		const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(line)
		if (!kv) continue
		let value = kv[2].trim()
		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
			value = value.slice(1, -1)
		}
		fields[kv[1]] = value
	}
	if (!fields.name || !fields.description) return null
	return { name: fields.name, description: fields.description }
}

/** `/skill-folder/relative/path` traversal guard: no `..`, no absolute/rooted paths. */
export function isSafeSkillRelativePath(path: string): boolean {
	if (!path || path.startsWith('/') || path.startsWith('\\')) return false
	const parts = path.split(/[\\/]/)
	return parts.every((p) => p !== '..' && p !== '')
}
