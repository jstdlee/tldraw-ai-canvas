// MyGo starts this file with Node. Electron calls startServer from its main
// process. The server bundle does not listen when AI_CANVAS_EMBEDDED=1.
const { startServer } = require('./server.cjs')

startServer(0, '127.0.0.1').catch((error) => {
	console.error(error)
	process.exit(1)
})
