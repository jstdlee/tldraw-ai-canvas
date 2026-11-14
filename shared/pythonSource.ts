/** The Python program the WASM runner executes. Inputs arrive as JSON. */

export function pythonProgram(
	userCode: string,
	inputs: Record<string, string | null>,
	outputIds: string[]
): string {
	return [
		'import json, io, contextlib',
		`inputs = json.loads(${JSON.stringify(JSON.stringify(inputs))})`,
		`user_code = json.loads(${JSON.stringify(JSON.stringify(userCode))})`,
		`keys = json.loads(${JSON.stringify(JSON.stringify(outputIds))})`,
		'ns = {"inputs": inputs}',
		'buf = io.StringIO()',
		// WP45: compiled as "<code>" so an error's traceback names the user's own line; on an
		// error the print() output so far is still written out (it used to be lost).
		'try:',
		'    with contextlib.redirect_stdout(buf):',
		'        exec(compile(user_code, "<code>", "exec"), ns, ns)',
		'except BaseException:',
		'    print("___LOG___" + buf.getvalue())',
		'    raise',
		'result = {key: ns.get(key) for key in keys}',
		'print("___LOG___" + buf.getvalue())',
		'print("___RESULT___" + json.dumps(result, default=str))',
		'',
	].join('\n')
}

export const DEFAULT_PYTHON = `# inputs["a"] and inputs["b"] are strings or None.
# Assign output. print() goes to the log.
words = (inputs.get("a") or "").split()
print("words:", len(words))
output = " ".join((word[:1].upper() + word[1:]) for word in words if word)
`

export function readPythonResult(stdout: string): { outputs: Record<string, unknown>; logs: string } {
	const logAt = stdout.lastIndexOf('___LOG___')
	const resultAt = stdout.lastIndexOf('___RESULT___')
	if (resultAt === -1) throw new Error('Python did not return a result')
	const logs = logAt === -1 ? '' : stdout.slice(logAt + '___LOG___'.length, resultAt).trim()
	const outputs = JSON.parse(stdout.slice(resultAt + '___RESULT___'.length)) as Record<string, unknown>
	return { outputs, logs }
}

/** The print() output in a run's stdout, also when the run failed (no result marker). */
export function readPythonLogs(stdout: string): string {
	const logAt = stdout.lastIndexOf('___LOG___')
	if (logAt === -1) return ''
	const resultAt = stdout.lastIndexOf('___RESULT___')
	const end = resultAt > logAt ? resultAt : stdout.length
	return stdout.slice(logAt + '___LOG___'.length, end).trim()
}
