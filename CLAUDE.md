# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Serendip — a local photo/video album browser (Electron + React + SQLite) with a smart-random "explore" mode that surfaces files via two-level weighted sampling. UI strings and code comments are in Chinese; keep new comments in the same language.

## Commands

```bash
npm run dev              # electron-vite dev (main + preload + renderer w/ HMR)
npm run typecheck        # node config + web config (run both before build)
npm run typecheck:node   # tsconfig.node.json — main + preload only
npm run typecheck:web    # tsconfig.web.json — renderer only
npm run lint             # eslint --cache .
npm run format           # prettier --write .
npm run build            # typecheck + electron-vite build (no installer)
npm run build:win        # full Windows installer via electron-builder
```

There is no test runner configured. `npm run build` runs typecheck first and is the closest thing to a verification gate.

`.npmrc` pins china-mirror registries for npm + Electron + sharp libvips + better-sqlite3 prebuilds — preserve it; reinstalling without these mirrors will be slow or fail in this environment.

## Architecture

Three Electron processes with a single shared IPC contract:

```
src/main/ipc/contract.ts ──┬── src/main/ipc/handlers.ts   (ipcMain.handle)
                           └── src/preload/index.ts        (ipcRenderer.invoke + contextBridge)
                                          │
                                          ▼
                           window.api    (typed via SerendipAPI)
                           used in       src/renderer/src/...
```

- `src/main/ipc/contract.ts` is the source of truth: `SerendipAPI` interface + `IPC` channel-name constants + `declare global { Window.api }`. Adding a new IPC call means editing **all three** of contract → handlers → preload, or the renderer call won't typecheck.
- TypeScript is split: `tsconfig.node.json` covers `electron.vite.config.*`, `src/main/**`, `src/preload/**`. `tsconfig.web.json` covers `src/renderer/src/**` plus `src/preload/*.d.ts`. The renderer imports types like `MediaItem` and `ExploreMode` from `src/main/recommender` directly — these cross-boundary type imports are intentional and load fine because they're erased at build time. Path alias: `@renderer/*` → `src/renderer/src/*`.

### Main process layout (`src/main/`)

- `index.ts` — app entry. **Registers the `serendip://` custom scheme as privileged before `app.whenReady`** (electron requires this ordering); after ready, opens DB → registers protocol handler → registers IPC handlers → creates window.
- `db/index.ts` — singleton better-sqlite3 connection at `<userData>/serendip.db` with WAL mode. Schema lives in a `migrations` array; bump with a new `{version, up}` entry, never edit applied migrations. Tables: `media_files`, `folders` (denormalized stats), `categories` (+ `position` for drag-reorder, added in migration 3) + `category_items`, `settings` (key/value, holds `rootPath`), `_migrations`.
- `scanner/index.ts` — `scanRoot(path, onProgress)`. Uses `fdir` to crawl, diffs against DB by `path`, batches inserts in transactions of 200, then rebuilds `folders` stats by aggregating from `media_files`. Emits `ScanProgress` through phases `walking → diffing → inserting → done`. Skips `.serendip-cache`, dotdirs, `node_modules`, `System Volume Information`, `$RECYCLE.BIN`.
- `recommender/index.ts` — two-level weighted sampling: folder weight is `1 / available_count^α` × cooldown; in-folder weight applies `likedBoost`, half-life cooldown, and `shown_count` penalty. Three modes (`prefer` / `balanced` / `explore`) tune these constants in `getModeParams`. Updates `last_shown_at` and `shown_count` after each batch. Restricts sampling to files under `settings.rootPath`.
- `categories/index.ts` — collection CRUD + item membership. `listCategories` returns each category's `position` (drag-reorder order) and a subquery `itemCount`. `reorderCategories(orderedIds)` rewrites `position` in a transaction. `addItemsToCategory` uses `INSERT OR IGNORE` (dedupes; returns count actually added) — designed to take an array so stage 5 batch-add reuses it as-is. Deleting a category relies on the schema's `ON DELETE CASCADE` to clear `category_items`. Unique-name violations are rethrown as friendly Chinese `Error` messages.
- `thumbnailer/protocol.ts` — handles `serendip://thumb/<id>` (calls `ensureThumb`, returns webp) and `serendip://video/<id>` (HTTP Range streaming via `fs.open` + manual `Content-Range` headers — required for `<video>` seek/hover-play to work). Always returns `Response`, never raw streams to the protocol API.
- `thumbnailer/index.ts` — `sharp` for images, `fluent-ffmpeg` (with `ffmpeg-static` + `@ffprobe-installer/ffprobe` static binaries) for videos. Thumbs are 320px webp, named by `sha256(path).slice(0,16)`, written to `<rootPath>/.serendip-cache/thumbs/`. Thumbs are generated lazily on first protocol request, not during scan.
- `media-types.ts` — supported extensions and `CACHE_DIR_NAME = '.serendip-cache'`. Adding a new format means updating these sets.

### Renderer (`src/renderer/src/`)

- `App.tsx` — sidebar + header shell. Routes the main pane between `EmptyState` / `ScanProgressPanel` / `ExploreView` / `CategoryView` based on `useLibraryStore`'s `view` (`{kind:'explore'} | {kind:'category', id}`). **Hosts the single app-wide `DndContext`** so drags cross from the main pane into the sidebar. Owns the category create/rename/delete dialogs (`PromptDialog` / `ConfirmDialog`) and the `DragOverlay`.
- `stores/ui.ts` — Zustand with `persist` middleware (`localStorage` key `serendip-ui`). Holds `theme` + `exploreMode`; on rehydrate it writes `data-theme` to `documentElement` so Tailwind theme variables in `assets/main.css` apply before first paint.
- `stores/library.ts` — Zustand (not persisted). Holds `view` (current main-pane route) alongside scan state. `startScan` subscribes to `onScanProgress` (returns an unsubscribe), invokes `scanRoot`, then `loadStats` on completion.
- `stores/categories.ts` — Zustand (not persisted). Mirrors the `categories` table; all mutating actions call the IPC then refresh, except `reorder` / `addItems` / `removeItem` which patch local state optimistically (reorder by index, itemCount by delta) to avoid flicker.
- `views/Explore.tsx` — masonry layout via `react-photo-album`. Pulls 30 recommendations at a time, dedupes by id with `seenIdsRef`, infinite-scrolls via `react-intersection-observer` with a 600px rootMargin. Treats two consecutive empty batches as "no more" — the recommender naturally returns fewer items as cooldowns saturate. Right-click menu includes an "添加到分类" group listing all categories.
- `views/CategoryView.tsx` — same masonry, but loads the full category once via `getCategoryItems` (no pagination — categories are small). Right-click "从分类移除" goes through a `ConfirmDialog`. Does **not** live-refresh when items are added from elsewhere; remounted via `key={view.id}` on category switch.
- `components/MediaCard.tsx` — renders `serendip://thumb/<id>` images, hover-plays videos via `serendip://video/<id>`, calls `setLiked` / `setDisliked`. Registered as a dnd-kit `useDraggable` (`data:{type:'media', item}`); it deliberately does **not** consume the draggable `transform` (the `DragOverlay` is the visual instead) — it only fades the source via `isDragging`.
- `components/CategoryList.tsx` — sidebar list. Each row is a `useSortable` (`data:{type:'category'}`) for drag-reorder and doubles as the media drop target. Single-click switches `view`; right-click opens rename/delete. Highlight when a media drag is over it is driven by `hoveredDropCategoryId` passed down from App.
- `components/ContextMenu.tsx` — floating menu **rendered through `createPortal` to `document.body`** (escapes the sidebar's `sticky` stacking context, which otherwise let main-pane cards paint over it). Items support `divider` and `header` (non-clickable group label) besides normal entries.
- `components/DragPreview.tsx` — the `DragOverlay` contents: `MediaDragPreview` (thumbnail, with a play badge for videos) and `CategoryDragPreview` (folder pill).
- `components/ConfirmDialog.tsx` / `components/PromptDialog.tsx` — generic modal confirm (Esc/Enter, danger variant) and single-line input (autofocus+select, inline validation; `onConfirm` may return an error string to display without closing).

#### Drag-and-drop (dnd-kit)

One `DndContext` in `App.tsx`. A `PointerSensor` with `activationConstraint:{distance:8}` lets clicks/right-clicks/hover on cards pass through — only a real >8px drag starts DnD. Two drag flows, distinguished by `active.data.current.type`:
- `media` → dropped on a category row ⇒ `addItemsToCategory`.
- `category` → dropped on another category row ⇒ `reorderCategories` (via `arrayMove`).

`collisionDetection` is custom and **pointer-position based, strict for media**: try `pointerWithin` first; if empty and the drag is `media`, return `[]` (no "closest" fallback — a category only responds when the cursor is actually over it). For `category` reorders it falls back to `closestCenter` so gaps between rows still resolve. The `DragOverlay` uses a `snapToCursor` modifier (computed from `getEventCoordinates(activatorEvent)` + the overlay's own rect) so the preview is centered on the cursor rather than anchored to the grab point.

### Conventions worth matching

- All cross-process strings go through `IPC.*` constants — never hardcode channel names.
- Use `ESCAPE '\\'` whenever doing `path LIKE ? || '%'` against DB paths; `escapeLike()` helpers exist in scanner and recommender — copy that pattern, Windows paths contain `\` which collides with the default escape.
- DB writes that touch many rows should use `db.transaction(...)` (see `insertBatch` in scanner) — orders-of-magnitude faster than per-row.
- Renderer never reads files directly; it only ever pulls bytes via `serendip://thumb/...` or `serendip://video/...`. If you need a new media-bytes endpoint, add it to `protocol.ts`, not as a new IPC call returning buffers.
- `README.md` lists some libraries (masonic, React 19) that are aspirational/early-phase. The actual installed deps in `package.json` are the ground truth — currently React 18.3 + `react-photo-album` for the masonry. `@dnd-kit/*` is now actually in use (stage 4 drag-and-drop). Don't trust the README's stack list when in doubt.
