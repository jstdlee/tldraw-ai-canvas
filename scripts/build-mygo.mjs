// Stage the existing web build and Node server, then package them with MyGo.
// The page and the server stay as they are. MyGo is only the desktop shell.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { chmod, cp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const mygoDir = path.join(root, 'mygo')
const resDir = path.join(mygoDir, 'resources')
const cacheDir = path.join(mygoDir, '.cache')
const nodeVersion = process.env.MYGO_NODE_VERSION || process.versions.node

/** MyGo platform → Node distribution name and archive type. */
const NODE_DIST = {
	'linux/arm64': ['linux-arm64', 'tar.xz', 'linux-arm64', 'bin/node'],
	'linux/amd64': ['linux-x64', 'tar.xz', 'linux-amd64', 'bin/node'],
	'darwin/arm64': ['darwin-arm64', 'tar.gz', 'darwin-arm64', 'bin/node'],
	'darwin/amd64': ['darwin-x64', 'tar.gz', 'darwin-amd64', 'bin/node'],
	'windows/amd64': ['win-x64', 'zip', 'windows-amd64', 'node.exe'],
}

function hostPlatform() {
	const osName = process.platform === 'win32' ? 'windows' : process.platform
	const arch = process.arch === 'x64' ? 'amd64' : process.arch
	return `${osName}/${arch}`
}

function run(cmd, args, opts = {}) {
	const result = spawnSync(cmd, args, { stdio: 'inherit', ...opts })
	if (result.status !== 0) {
		throw new Error(`${cmd} ${args.join(' ')} failed (${result.status ?? result.error?.message})`)
	}
}

async function download(url, dest) {
	const response = await fetch(url)
	if (!response.ok) throw new Error(`${url} returned ${response.status}`)
	await pipeline(response.body, createWriteStream(dest))
}

async function sha256(file) {
	const data = await readFile(file)
	return createHash('sha256').update(data).digest('hex')
}

async function nodeBinary(platform) {
	const spec = NODE_DIST[platform]
	if (!spec) throw new Error(`No Node runtime mapping for ${platform}`)
	const [distName, ext, resourceDir, binName] = spec
	const base = `node-v${nodeVersion}-${distName}`
	const archiveName = `${base}.${ext}`
	await mkdir(cacheDir, { recursive: true })
	const archive = path.join(cacheDir, archiveName)
	const sumsPath = path.join(cacheDir, `SHASUMS256-${nodeVersion}.txt`)
	const distURL = `https://nodejs.org/dist/v${nodeVersion}`
	if (!(await readFile(sumsPath).then(() => true, () => false))) {
		await download(`${distURL}/SHASUMS256.txt`, sumsPath)
	}
	if (!(await readFile(archive).then(() => true, () => false))) {
		await download(`${distURL}/${archiveName}`, archive)
	}
	const sums = await readFile(sumsPath, 'utf8')
	const line = sums.split('\n').find((row) => row.endsWith(`  ${archiveName}`))
	const want = line?.slice(0, 64)
	const got = await sha256(archive)
	if (!want || got !== want) throw new Error(`${archiveName} checksum mismatch`)

	const extract = path.join(cacheDir, `extract-${base}`)
	await rm(extract, { recursive: true, force: true })
	await mkdir(extract, { recursive: true })
	if (ext === 'zip') {
		run('unzip', ['-q', archive, '-d', extract])
	} else {
		run('tar', ['-xf', archive, '-C', extract])
	}
	const from = path.join(extract, base, binName)
	const destDir = path.join(resDir, resourceDir, 'bin')
	await mkdir(destDir, { recursive: true })
	const dest = path.join(destDir, path.basename(binName))
	await rename(from, dest).catch(async () => {
		await cp(from, dest)
	})
	await chmod(dest, 0o755)
}

async function stage() {
	await build({
		bundle: true,
		platform: 'node',
		target: 'node22',
		format: 'cjs',
		logLevel: 'info',
		entryPoints: [path.join(root, 'server/index.ts')],
		outfile: path.join(root, 'dist-electron/server.cjs'),
	})
	await rm(path.join(resDir, 'dist'), { recursive: true, force: true })
	await mkdir(resDir, { recursive: true })
	await cp(path.join(root, 'dist'), path.join(resDir, 'dist'), { recursive: true })
	await cp(path.join(root, 'dist-electron/server.cjs'), path.join(resDir, 'server.cjs'))
	await cp(path.join(mygoDir, 'launcher.cjs'), path.join(resDir, 'launcher.cjs'))
	await cp(path.join(root, 'build/icon.png'), path.join(resDir, 'icon.png'))
}

const platforms = (process.env.MYGO_PLATFORMS || hostPlatform())
	.split(',')
	.map((item) => item.trim())
	.filter(Boolean)

await stage()
for (const platform of platforms) await nodeBinary(platform)

const version = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).version
const configPath = path.join(mygoDir, 'mygo.json')
const config = JSON.parse(await readFile(configPath, 'utf8'))
if (config.version !== version) {
	config.version = version
	await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`)
}

const go = process.env.GO || 'go'
run(go, ['tool', 'mygo', 'build', '-platform', platforms.join(',')], { cwd: mygoDir })
