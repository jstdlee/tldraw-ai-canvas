# WP47 — Groups: ungroup, wires inside groups, collapse to one card

Read `docs/rework/RULES.md` first. tldraw is 5.6.0.

## Bugs (reproduced 2026-11-14)

1. **Cannot ungroup.** Select a group made with Ctrl+G (or "Group selection"), press Ctrl+Shift+G:
   nothing happens. The context menu has no Ungroup item. Find why (`client/pipeline/groups/`,
   `KeepGroupShapeUtil.tsx` patches tldraw's `GroupShapeUtil`; `canvasActionOverrides` in
   `client/clips/CanvasMenus.tsx` may replace the `ungroup` action or its shortcut) and fix it.
   Ungroup must also work for a group that is focused (dived into), and for a "box" group
   (`meta.boxOf`, made by Group as box → Open).
2. **Wires break out of groups.** Group two cards that are wired together: both cards go into the
   group, but the wire between them stays a child of the page. The group does not hold its own
   wire, so it is not "together": the outline and selection do not include it, copy / duplicate /
   move to page of the group drop or orphan the wire, and the wire draws in the wrong layer.
   Fix: when shapes are grouped, wires (`connection` shapes) with **both** ends on shapes inside the
   group move into the group (keep `keepConnectionsAtBottom` working inside groups). Wires with one
   end outside stay on the page and keep following the card. Ungroup moves them back. Apply the same
   rule when a shape is dragged into or out of a group, and to tldraw arrows bound at both ends.
   Check: duplicate a group → the copy has its own inner wires; copy/paste a group → same; move a
   group to another page → inner wires go too.

## Feature: collapse a group to one card

The user wants any group to fold into a single card that looks like a card, with the inputs and
outputs of its children, and unfold back.

There is already "Group as box" (`packSelection`, `unpack`, `openGroup`, `closeGroup` in
`client/pipeline/subgraph.ts`): it packs selected cards into a `subgraph` card with boundary ports
(`shared/groupPorts.ts`), and Open turns it into a group with `meta.boxOf`. Reuse it; do not write a
second packer.

- Every group label (`KeepGroupShapeUtil`) gets a **Collapse** button (icon, tooltip "Collapse to one
  card"). It packs the group's children into a box card at the group's place and keeps the group's
  label as the card title. Shortcut **Alt+C** when one group is selected (check for clashes; Compare
  uses `?c` today, so pick **Alt+Shift+C** if needed and say so).
- The collapsed card shows the ports the group needs from outside, exactly as Group as box does:
  inputs wired from outside, outputs wired to outside, and unwired outputs of the last cards.
- **Expand** on the box card (its existing Open / Ungroup box actions) restores the group with the
  same label, positions and inner wires. Collapse → Expand → Collapse must be stable (no growth, no
  lost wires, no moved cards).
- A group that holds non-card shapes (text, notes, images, arrows): they collapse with it (packed and
  hidden like cards in a box) and come back on Expand. If `packSelection` cannot hold non-card shapes
  today, extend it; non-card shapes have no ports.
- Running a collapsed card runs its inner flow, as a box does today.
- Rename "Group as box" in menus to **Collapse to card** and "Ungroup box" to **Expand**, so there is
  one name for one thing. Keep the action ids.

## Tests

- E2E `tests/e2e/groups.spec.ts`: Ctrl+G then Ctrl+Shift+G restores the shapes to the page; the
  menu Ungroup item works; a wire between two grouped cards is a child of the group and returns to
  the page on ungroup; a wire to an outside card stays on the page and follows when the group moves;
  duplicate and copy/paste of a group keep inner wires; collapse a group of three wired cards plus a
  note → one card with the right ports, wired to the outside cards; run it; expand restores
  everything (positions within 1 px, same wires, note back); collapse twice is stable.
- Update `tests/e2e/group-box.spec.ts` and `group-box-field-ports.spec.ts` only where the menu labels
  changed.

## Done means

`npx tsc --noEmit -p .` clean, `npx vitest run` green, your spec and the group specs pass with
`CHOKIDAR_USEPOLLING=1 CHOKIDAR_INTERVAL=2000 E2E_WEB_PORT=5205 E2E_API_PORT=8805 npx playwright test <files>`.
Do not run the whole e2e suite. Do not commit.
