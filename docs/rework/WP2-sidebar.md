# WP2 — Node library side panel and its collapse

Feedback item: #1 (side panel collapse styling). Read `RULES.md` first. WP1 is done: use the kit
in `client/ui/` (icons, `UiIconButton`, `UiTextInput`, …).

## Today

- `client/App.tsx` (~lines 270–300): grid layout `.app-layout`; the sidebar
  `.image-pipeline-sidebar` holds `ImagePipelineSidebar` and a `.SidebarEdgeHandle` button with
  text `‹`/`›`. Classes `is-library-hidden` (panel off) and `is-library-rail` (collapsed).
- `client/shell/shellState.ts`: `$libraryRail` atom, **not persisted**. Toggled by Shift+B
  (`client/shell/ShellChrome.tsx` ~L27 and ~L266) and a palette command (~L80).
- `client/pipeline/components/ImagePipelineSidebar.tsx`: header "Nodes" with a `◁` text button;
  list of groups; "My nodes" group with `★` and `×` text glyphs.
- CSS: `client/ai/ai.css` ~347–377 (grid, width 240/200 px), `client/shell/shell.css` ~175–201
  (rail 44 px: it just hides the list, so the rail is an empty strip),
  `client/pipeline/index.css` ~761–900 (`.SidebarEdgeHandle`, `.ImagePipelineSidebar*`).
- No transitions. The collapsed rail shows nothing useful.

## Target design

```
 open (248 px)                          rail (52 px)        hidden
┌──────────────────────────┐            ┌────┐
│ Nodes            [⇤]     │            │[⇥] │             (nothing; restore from
│ [🔍 Search nodes…     ]  │            │────│              main menu / Shift+N)
│ ▾ My nodes               │            │ ★  │ ← category icons; hover = tooltip;
│   ▢ Summarise PDF   [🗑] │            │ ⤓  │   click = flyout listing that
│ ▾ Input                  │            │ T  │   category's nodes (click or drag
│   ▢ Text                 │            │ ✦  │   to add), like tldraw's tool
│   ▢ Number   …           │            │ …  │   overflow popover
│ ▸ Text                   │            └────┘
└──────────────────────────┘
```

1. **Look like a tldraw panel.** Background `--tl-color-panel`, right border 1px
   `--tl-color-divider`, no heavy shadow. Header row 40 px: title "Nodes" (tldraw font, 13px,
   600) and a `UiIconButton` with a new icon `IconSidebarCollapse` (panel with left arrow) /
   `IconSidebarExpand` — add both to `client/ui/icons.tsx`. Delete `.SidebarEdgeHandle` and its
   button in `App.tsx`.
2. **Search.** A `UiTextInput` under the header filters items by title, type id and category label
   (case-insensitive). While searching, show matches flat (no group headers) and hide empty groups.
   Escape clears. Enter adds the first match at the free spot (see WP3; for now use the existing
   `createNodeAtCenter`).
3. **Collapsible groups.** Each group header is a button with a chevron; open/closed state persists
   in `localStorage` key `oh-my-tldraw:library-groups` (JSON array of closed group ids). Wrap all
   localStorage access in try/catch.
4. **Items.** Row height 32 px, icon 18 px in a 24 px box (`--tl-color-text-3`), title 13 px, hover
   `--tl-color-muted-2`, radius `--tl-radius-2`. Keep the existing click/drag logic exactly.
   "My nodes": icon `IconGroup` instead of `★`; delete = `UiIconButton` with `IconTrash`, visible on
   row hover only.
5. **Rail mode (collapsed).** Width 52 px. Show the expand button on top, then one
   `UiIconButton` per non-empty group (My nodes first), using a group icon: add a `GROUP_ICONS`
   map in `ImagePipelineSidebar.tsx` that uses the icon of the first node of the group (from
   `def.icon`) unless a better icon exists in `client/ui/icons.tsx`. Tooltip = group label.
   Click opens a flyout (`TldrawUiPopover` + `TldrawUiPopoverTrigger` + `TldrawUiPopoverContent`,
   `side="right"`) with that group's items as the same `SidebarItem` rows (click and drag work).
   Closing the flyout after a click-to-add.
6. **Smooth.** Animate width with `transition: width 160ms ease` on the sidebar column; the grid
   column must be `auto` so the canvas follows. Respect `prefers-reduced-motion` (no transition).
7. **Persist rail state.** Make `$libraryRail` read its initial value from `localStorage`
   (`oh-my-tldraw:library-rail`) and write on change (use `react` effect in `App.tsx` or a
   `react()` from tldraw state; try/catch).
8. **Narrow windows.** Under 900 px window width start in rail mode if no stored value.
9. Dark mode: the sidebar already toggles `tl-theme__dark`; make sure all new CSS uses variables.

## Do not change

- The chat float button / chat modal (`.chat-float-*`) — except replace its `✦` text with
  `<IconSparkle/>` from the kit.
- Node creation logic (WP3 does placement).

## Tests

- Pure filter function `filterLibrary(defs, query)` in `shared/libraryFilter.ts` with a test in
  `tests/libraryFilter.test.ts` (title match, type id match, category match, empty query = all).

## How the planner will check

- Collapse/expand with the header button and Shift+B: smooth, state survives reload.
- Rail shows group icons; flyout adds nodes by click and by drag.
- Search finds "pdf", "json", "chart".
- Light and dark.
