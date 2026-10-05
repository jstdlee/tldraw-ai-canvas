/** What this app keeps from tldraw, and what it adds. */

export interface FeatureRow {
	name: string
	tldraw: string
	here: string
}

export const FEATURE_ROWS: FeatureRow[] = [
	{ name: 'Draw, geo, text, note, arrow, frame', tldraw: 'Yes', here: 'Kept' },
	{ name: 'Image, video, embed, bookmark', tldraw: 'Yes', here: 'Kept. Video node adds an autoplay switch.' },
	{ name: 'Pages, export, undo, dark mode, snap', tldraw: 'Yes', here: 'Kept' },
	{ name: 'Groups', tldraw: 'Group outline hides until you focus it. One child deletes the group.', here: 'Outline and top label stay. Dive in, then Back. A group with one child stays. Group text is each member on a new line.' },
	{ name: 'Rename', tldraw: 'Shape text only', here: 'Rename a component or a group. The label sits on the top edge.' },
	{ name: 'Packed node', tldraw: 'No', here: 'Pack keeps the inner ports on the card. Double-click unpacks.' },
	{ name: 'Library rail', tldraw: 'No', here: 'Shift-B or the collapse icon shrinks the left panel to a rail.' },
	{ name: 'Sleep, emoji, motion', tldraw: 'No', here: 'Sleep waits. Emoji is borderless. Motion moves text, emoji, or an image.' },
	{ name: 'For each', tldraw: 'No', here: 'A progress bar shows how far the loop has gone.' },
	{ name: 'Minimap', tldraw: 'Not in the default UI', here: 'Map view. Drag to move. Search hits blink.' },
	{ name: 'Find', tldraw: 'No find bar', here: 'Regexp, case, component type, asset type, highlight, replace preview, dry run' },
	{ name: 'Command palette', tldraw: 'No Ctrl-P insert', here: 'Ctrl-P searches features and inserts a node' },
	{ name: 'Node pipelines', tldraw: 'No', here: 'Text, net, LLM, image, logic, data, tools, media' },
	{ name: 'Unconnected output', tldraw: 'No', here: 'Spills onto a text or image shape. The card does not keep the result body.' },
	{ name: 'Large view', tldraw: 'No', here: 'Max button on inputs and on the Output preview' },
	{ name: 'Charts', tldraw: 'No', here: 'Chart node uses ECharts' },
	{ name: 'Tables', tldraw: 'No', here: 'CSV and TSV column tools in the page. Pandas is not bundled.' },
	{ name: 'SQL', tldraw: 'No', here: 'PGlite in the page. SQLite file import when sqlite3 is installed.' },
	{ name: 'Local tools', tldraw: 'No', here: 'Allowlisted gawk, grep, sed, cut, sort, uniq, wc. One SSH command.' },
	{ name: 'Terminal', tldraw: 'No', here: 'Command runner with height, width, and both. Not a full PTY.' },
	{ name: 'Agents on the canvas', tldraw: 'No', here: 'Chat agent, plus grok, pi, or omp if that program is installed' },
	{ name: 'Model lists', tldraw: 'No', here: 'OpenRouter free models, OpenCode Go models, and a price-band picker' },
	{ name: 'Hugging Face', tldraw: 'No', here: 'One inference call when a token is set. Not a full HF workflow app.' },
	{ name: 'AI and the selection', tldraw: 'No', here: 'The star sends the selection text plus a static node catalog. Not MCP.' },
	{ name: 'History', tldraw: 'Undo only', here: 'Searchable operation log. Past 100 items go to disk.' },
	{ name: 'Backup', tldraw: 'No', here: 'Timer to a folder or S3-compatible storage. Google Drive is a later menu item.' },
	{ name: 'Collaboration', tldraw: 'In tldraw sync products', here: 'Not included' },
	{ name: 'Desktop shell', tldraw: 'No', here: 'Electron and MyGo. MyGo is one installer per system.' },
]

export function featurePrompt(): string {
	return FEATURE_ROWS.map((row) => `${row.name}: tldraw=${row.tldraw}; this app=${row.here}`).join('\n')
}
