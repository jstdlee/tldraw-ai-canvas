/**
 * Desktop (offline) app. The local server — the same one `npm start` runs —
 * starts inside this process on a free 127.0.0.1 port; the window loads it.
 * All data (AI providers, images, saved nodes) lives in the user data folder.
 */
import { app, BrowserWindow, Menu, session, shell } from 'electron'
import { join } from 'node:path'

const isDev = !app.isPackaged

if (!app.requestSingleInstanceLock()) {
	app.quit()
}

let mainWindow: BrowserWindow | null = null

async function startLocalServer(): Promise<number> {
	process.env.AI_CANVAS_EMBEDDED = '1'
	process.env.NODE_ENV = 'production'
	process.env.DATA_DIR = join(app.getPath('userData'), 'data')
	process.env.STATIC_DIR = join(app.getAppPath(), 'dist')
	// Loaded after the environment is set: the server reads it at import time.
	// eslint-disable-next-line @typescript-eslint/no-require-imports
	const server = require('./server.cjs') as { startServer(port?: number, host?: string): Promise<number> }
	return server.startServer(0, '127.0.0.1')
}

function isAppUrl(url: string, origin: string) {
	return url === origin || url.startsWith(origin + '/')
}

async function createWindow() {
	const port = await startLocalServer()
	const origin = `http://127.0.0.1:${port}`

	mainWindow = new BrowserWindow({
		width: 1440,
		height: 900,
		minWidth: 800,
		minHeight: 560,
		title: 'AI Canvas',
		backgroundColor: '#f9fafb',
		icon: join(__dirname, '..', 'build', 'icon.png'),
		webPreferences: {
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
			spellcheck: true,
		},
	})

	// Links to other sites open in the default browser, never inside the app.
	mainWindow.webContents.setWindowOpenHandler(({ url }) => {
		if (/^https?:\/\//.test(url) && !isAppUrl(url, origin)) shell.openExternal(url)
		return { action: 'deny' }
	})
	mainWindow.webContents.on('will-navigate', (event, url) => {
		if (!isAppUrl(url, origin)) {
			event.preventDefault()
			if (/^https?:\/\//.test(url)) shell.openExternal(url)
		}
	})

	await mainWindow.loadURL(origin)
	mainWindow.on('closed', () => {
		mainWindow = null
	})
}

app.on('second-instance', () => {
	if (!mainWindow) return
	if (mainWindow.isMinimized()) mainWindow.restore()
	mainWindow.focus()
})

app.whenReady().then(async () => {
	// Camera node, clipboard (copy output): allow; everything else: deny.
	session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
		callback(['media', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen'].includes(permission))
	})

	Menu.setApplicationMenu(
		Menu.buildFromTemplate([
			...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
			{ role: 'fileMenu' },
			{ role: 'editMenu' },
			{
				label: 'View',
				submenu: [
					{ role: 'reload' },
					{ role: 'toggleDevTools', visible: isDev },
					{ type: 'separator' },
					{ role: 'resetZoom' },
					{ role: 'zoomIn' },
					{ role: 'zoomOut' },
					{ type: 'separator' },
					{ role: 'togglefullscreen' },
				],
			},
			{ role: 'windowMenu' },
			{
				label: 'Help',
				submenu: [
					{
						label: 'Open data folder',
						click: () => shell.openPath(join(app.getPath('userData'), 'data')),
					},
				],
			},
		])
	)

	try {
		await createWindow()
	} catch (e) {
		console.error('Could not start the app:', e)
		app.quit()
	}

	app.on('activate', () => {
		if (BrowserWindow.getAllWindows().length === 0) createWindow()
	})
})

app.on('window-all-closed', () => {
	if (process.platform !== 'darwin') app.quit()
})
