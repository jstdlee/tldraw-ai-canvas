// MyGo starts this file with Node. Electron calls startServer from its main
// process. The server bundle does not listen when AI_CANVAS_EMBEDDED=1.
const { startServer } = require('./server.cjs')

// A stable port keeps the window origin constant, so the canvas in IndexedDB
// (keyed by origin) survives restarts — the same reasoning as electron/main.ts.
// Port 0 would pick a new one each launch and the saved canvas would look empty.
// A different port from Electron's 47201 so both shells can run at once.
startServer(47202, '127.0.0.1').catch(() => {
	startServer(0, '127.0.0.1').catch((error) => {
		console.error(error)
		process.exit(1)
	})
})
