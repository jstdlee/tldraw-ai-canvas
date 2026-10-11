import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import initSqlJs from 'sql.js'
import { expect, test } from '@playwright/test'
import { createNode, gotoApp, nodeLocator } from './helpers'

/** Build a tiny real .sqlite file with sql.js (Node), for the Database card's upload test. */
async function buildFixtureSqlite(): Promise<string> {
	const SQL = await initSqlJs()
	const db = new SQL.Database()
	db.run('CREATE TABLE people (name TEXT, age INTEGER)')
	db.run("INSERT INTO people (name, age) VALUES ('Ada', 30), ('Lin', 25)")
	const bytes = db.export()
	db.close()
	const dir = mkdtempSync(join(tmpdir(), 'tldraw-e2e-db-'))
	const path = join(dir, 'fixture.sqlite')
	writeFileSync(path, bytes)
	return path
}

test.describe('Database card (SQLite)', () => {
	test.beforeEach(async ({ page }) => {
		await gotoApp(page)
	})

	test('uploading a .sqlite file lists its tables; clicking one shows result rows', async ({ page }) => {
		const filePath = await buildFixtureSqlite()
		const dbId = await createNode(
			page,
			{ type: 'database', fileUrl: '', fileName: '', fileSize: 0, sql: '', tables: '', lastOutput: null, lastInfo: '', error: null, source: 'sqlite' },
			{ x: 0, y: 0 }
		)

		const node = nodeLocator(page, dbId)
		await node.locator('input[type="file"]').setInputFiles(filePath)

		const tableRow = node.locator('.DatabaseNode-table', { hasText: 'people' })
		await expect(tableRow).toBeVisible()

		await tableRow.click()

		const table = node.locator('.UiTable')
		await expect(table).toBeVisible()
		await expect(table).toContainText('Ada')
		await expect(table).toContainText('Lin')
	})
})
