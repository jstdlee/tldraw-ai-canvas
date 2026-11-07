/**
 * Comments on the canvas (tldraw's @tldraw/commenting): pins, threads, replies, reactions, a list.
 * The records live in the canvas store, so they save with the canvas and with canvas files.
 * This app has one local user, so every comment has the same author.
 *
 * License: tldraw runs comments with no key on an http: origin (the dev server and the desktop app's
 * local server). Its license terms still ask for a commenting license in production.
 */
// @ts-expect-error Exported at runtime, left out of tldraw's public types.
import { useLocalStore } from '@tldraw/editor'
import {
	CanvasComments,
	CanvasCommentsSidebar,
	CommentAuthor,
	CommentsMenuItem,
	toggleCommentsSidebar,
	useCommentsSidebarOpen,
} from '@tldraw/commenting'
import { useMemo } from 'react'
import {
	commentSchemaRecords,
	defaultAssetUtils,
	defaultBindingUtils,
	defaultShapeUtils,
	TLAnyBindingUtilConstructor,
	TLAnyShapeUtilConstructor,
	TldrawUiMenuCheckboxItem,
	TldrawUiMenuGroup,
	TldrawUiMenuItem,
	TLStoreWithStatus,
	useEditor,
	useTools,
} from 'tldraw'

const LOCAL_USER_ID = 'me'
const LOCAL_AUTHOR: CommentAuthor = { name: 'You', color: '#EC5E41' }
const resolveAuthor = (id: string) => (id === LOCAL_USER_ID ? LOCAL_AUTHOR : undefined)

/** Custom utils replace a default util of the same type, as <Tldraw> does for its own store. */
function withDefaults<T extends { type: string }>(custom: readonly T[], defaults: readonly T[]): T[] {
	const types = new Set(custom.map((util) => util.type))
	return [...defaults.filter((util) => !types.has(util.type)), ...custom]
}

/**
 * The canvas store, saved in the browser under `persistenceKey`, with the comment record types.
 * <Tldraw persistenceKey> gives no way to add record types, so this calls the same hook it uses.
 * useLocalStore is not in tldraw's public types; tldraw is pinned to one exact version.
 */
export function useCanvasStore(
	persistenceKey: string,
	shapeUtils: readonly TLAnyShapeUtilConstructor[],
	bindingUtils: readonly TLAnyBindingUtilConstructor[]
): TLStoreWithStatus {
	const options = useMemo(
		() => ({
			persistenceKey,
			records: commentSchemaRecords,
			shapeUtils: withDefaults(shapeUtils, defaultShapeUtils),
			bindingUtils: withDefaults(bindingUtils, defaultBindingUtils),
			assetUtils: defaultAssetUtils,
		}),
		[persistenceKey, shapeUtils, bindingUtils]
	)
	return (useLocalStore as unknown as (o: typeof options) => TLStoreWithStatus)(options)
}

/** Mount in InFrontOfTheCanvas: the pins, the open thread and the list panel. */
export function CommentsLayer() {
	return (
		<>
			<CanvasComments currentUserId={LOCAL_USER_ID} resolveAuthor={resolveAuthor} />
			<CanvasCommentsSidebar currentUserId={LOCAL_USER_ID} resolveAuthor={resolveAuthor} />
		</>
	)
}

/** Context menu: the tool's own item starts the comment where the menu was opened. */
export function CommentMenuItem() {
	const tool = useTools().comment
	return tool ? <TldrawUiMenuItem {...tool} kbd={undefined} /> : null
}

/** Main menu: show or hide the pins, and open the list. */
export function CommentsMenuGroup() {
	const editor = useEditor()
	const open = useCommentsSidebarOpen()
	return (
		<TldrawUiMenuGroup id="comments">
			<CommentsMenuItem />
			<TldrawUiMenuCheckboxItem
				id="comments-list"
				label="Comments list"
				checked={open}
				readonlyOk
				onSelect={() => toggleCommentsSidebar(editor)}
			/>
		</TldrawUiMenuGroup>
	)
}
