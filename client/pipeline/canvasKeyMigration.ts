/**
 * One-time rename of the canvas persistence key from "tldraw-ai-canvas" to
 * "oh-my-tldraw". The canvas lives in IndexedDB databases named after the key;
 * without a copy, existing canvases would vanish on the first load after the
 * rename. This copies every database under the old prefix to the new one, then
 * deletes the old databases. Safe to run on every boot: it is a no-op once done.
 */

const OLD_PREFIX = 'tldraw-ai-canvas'
const NEW_PREFIX = 'oh-my-tldraw'
const DONE_KEY = 'oh-my-tldraw:migrated'

function openDb(name: string): Promise<IDBDatabase> {
	return new Promise((resolvePromise, reject) => {
		const request = indexedDB.open(name)
		request.onsuccess = () => resolvePromise(request.result)
		request.onerror = () => reject(request.error ?? new Error(`Cannot open ${name}`))
		// No upgrade handler: if it does not exist, we have nothing to copy.
		request.onupgradeneeded = () => {
			request.transaction?.abort()
			reject(new Error(`${name} has no stores`))
		}
	})
}

function copyStore(source: IDBDatabase, target: IDBDatabase, storeName: string): Promise<void> {
	return new Promise((resolvePromise, reject) => {
		const readTx = source.transaction(storeName, 'readonly')
		const writeTx = target.transaction(storeName, 'readwrite')
		const read = readTx.objectStore(storeName)
		const write = writeTx.objectStore(storeName)
		read.openCursor().onsuccess = (event) => {
			const cursor = (event.target as IDBRequest<IDBCursorWithValue | null>).result
			if (!cursor) return
			write.put(cursor.value, cursor.key)
			cursor.continue()
		}
		writeTx.oncomplete = () => resolvePromise()
		writeTx.onerror = () => reject(writeTx.error ?? new Error(`Copy into ${storeName} failed`))
		readTx.onerror = () => reject(readTx.error ?? new Error(`Read of ${storeName} failed`))
	})
}

function createWithStores(name: string, storeNames: string[]): Promise<IDBDatabase> {
	return new Promise((resolvePromise, reject) => {
		const request = indexedDB.open(name, Date.now())
		request.onupgradeneeded = () => {
			const db = request.result
			for (const store of storeNames) {
				if (!db.objectStoreNames.contains(store)) db.createObjectStore(store)
			}
		}
		request.onsuccess = () => resolvePromise(request.result)
		request.onerror = () => reject(request.error ?? new Error(`Cannot create ${name}`))
	})
}

function deleteDb(name: string): Promise<void> {
	return new Promise((resolvePromise) => {
		const request = indexedDB.deleteDatabase(name)
		request.onsuccess = () => resolvePromise()
		request.onerror = () => resolvePromise() // Best effort; the copy is what matters.
		request.onblocked = () => resolvePromise()
	})
}

async function migrateOne(oldName: string): Promise<void> {
	const newName = oldName.replace(OLD_PREFIX, NEW_PREFIX)
	if (newName === oldName) return
	let source: IDBDatabase
	try {
		source = await openDb(oldName)
	} catch {
		return // Not a real database (or empty); nothing to migrate.
	}
	const storeNames = Array.from(source.objectStoreNames)
	if (!storeNames.length) {
		source.close()
		return
	}
	const target = await createWithStores(newName, storeNames)
	for (const store of storeNames) {
		await copyStore(source, target, store)
	}
	source.close()
	target.close()
	await deleteDb(oldName)
}

/**
 * Copy the old-key databases to the new key, once. Resolves when done (or when
 * there is nothing to do); never rejects, so a failed migration cannot block boot.
 */
export async function migrateCanvasKey(): Promise<void> {
	if (typeof indexedDB === 'undefined') return
	try {
		if (localStorage.getItem(DONE_KEY)) return
	} catch {
		// localStorage may be unavailable; try the migration anyway.
	}
	try {
		const dbs = (await indexedDB.databases?.()) ?? []
		for (const info of dbs) {
			const name = info.name
			if (name && name.startsWith(OLD_PREFIX)) await migrateOne(name)
		}
	} catch {
		// A failed migration leaves the old data in place; the app still boots.
	}
	try {
		localStorage.setItem(DONE_KEY, '1')
	} catch {
		// Ignore.
	}
}
