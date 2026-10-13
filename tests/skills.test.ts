import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { isSafeSkillRelativePath, parseSkillFrontMatter } from '../shared/skills'

describe('skills: front matter parsing (pure)', () => {
	it('parses name + description from --- front matter', () => {
		const md = '---\nname: My Skill\ndescription: Does the thing\n---\n\nBody text'
		expect(parseSkillFrontMatter(md)).toEqual({ name: 'My Skill', description: 'Does the thing' })
	})

	it('strips quotes around values', () => {
		const md = '---\nname: "Quoted"\ndescription: \'Also quoted\'\n---\n'
		expect(parseSkillFrontMatter(md)).toEqual({ name: 'Quoted', description: 'Also quoted' })
	})

	it('returns null with no front matter', () => {
		expect(parseSkillFrontMatter('# just a heading')).toBeNull()
	})

	it('returns null when a required field is missing', () => {
		expect(parseSkillFrontMatter('---\nname: X\n---\n')).toBeNull()
	})
})

describe('skills: path traversal guard', () => {
	it('allows a plain relative path', () => {
		expect(isSafeSkillRelativePath('reference/foo.md')).toBe(true)
	})
	it('rejects .. segments', () => {
		expect(isSafeSkillRelativePath('../SKILL.md')).toBe(false)
		expect(isSafeSkillRelativePath('a/../../b')).toBe(false)
	})
	it('rejects absolute paths', () => {
		expect(isSafeSkillRelativePath('/etc/passwd')).toBe(false)
	})
	it('rejects empty segments', () => {
		expect(isSafeSkillRelativePath('a//b')).toBe(false)
	})
})

describe('skills: filesystem scan', () => {
	const dir = join(__dirname, '.tmp-skills-test')
	beforeAll(() => {
		process.env.DATA_DIR = dir
		rmSync(dir, { recursive: true, force: true })
		mkdirSync(join(dir, 'skills', 'good', 'reference'), { recursive: true })
		writeFileSync(
			join(dir, 'skills', 'good', 'SKILL.md'),
			'---\nname: Good Skill\ndescription: A valid one\n---\n\nUse this.'
		)
		writeFileSync(join(dir, 'skills', 'good', 'reference', 'notes.md'), 'extra notes')
		mkdirSync(join(dir, 'skills', 'bad'), { recursive: true })
		writeFileSync(join(dir, 'skills', 'bad', 'SKILL.md'), '# no front matter here')
	})
	afterAll(() => {
		rmSync(dir, { recursive: true, force: true })
		delete process.env.DATA_DIR
	})

	it('finds only the skill with valid front matter, and lists its other files', async () => {
		const { scanSkills, readSkillFile, readSkillMd } = await import('../server/skills')
		const found = scanSkills()
		expect(found.map((s) => s.id)).toEqual(['good'])
		expect(found[0].name).toBe('Good Skill')
		expect(found[0].files).toContain('reference/notes.md')
		expect(readSkillMd('good')).toMatch(/Good Skill/)
		expect(readSkillFile('good', 'reference/notes.md')).toBe('extra notes')
		expect(() => readSkillFile('good', '../bad/SKILL.md')).toThrow()
		expect(() => readSkillFile('good', '/etc/passwd')).toThrow()
	})
})
