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
- `db/index.ts` — singleton better-sqlite3 connection at `<userData>/serendip.db` with WAL mode. Schema lives in a `migrations` array; bump with a new `{version, up}` entry, never edit applied migrations. Tables: `media_files`, `folders` (denormalized stats), `categories` + `category_items`, `settings` (key/value, holds `rootPath`), `_migrations`.
- `scanner/index.ts` — `scanRoot(path, onProgress)`. Uses `fdir` to crawl, diffs against DB by `path`, batches inserts in transactions of 200, then rebuilds `folders` stats by aggregating from `media_files`. Emits `ScanProgress` through phases `walking → diffing → inserting → done`. Skips `.serendip-cache`, dotdirs, `node_modules`, `System Volume Information`, `$RECYCLE.BIN`.
- `recommender/index.ts` — two-level weighted sampling: folder weight is `1 / available_count^α` × cooldown; in-folder weight applies `likedBoost`, half-life cooldown, and `shown_count` penalty. Three modes (`prefer` / `balanced` / `explore`) tune these constants in `getModeParams`. Updates `last_shown_at` and `shown_count` after each batch. Restricts sampling to files under `settings.rootPath`.
- `thumbnailer/protocol.ts` — handles `serendip://thumb/<id>` (calls `ensureThumb`, returns webp) and `serendip://video/<id>` (HTTP Range streaming via `fs.open` + manual `Content-Range` headers — required for `<video>` seek/hover-play to work). Always returns `Response`, never raw streams to the protocol API.
- `thumbnailer/index.ts` — `sharp` for images, `fluent-ffmpeg` (with `ffmpeg-static` + `@ffprobe-installer/ffprobe` static binaries) for videos. Thumbs are 320px webp, named by `sha256(path).slice(0,16)`, written to `<rootPath>/.serendip-cache/thumbs/`. Thumbs are generated lazily on first protocol request, not during scan.
- `media-types.ts` — supported extensions and `CACHE_DIR_NAME = '.serendip-cache'`. Adding a new format means updating these sets.

### Renderer (`src/renderer/src/`)

- `App.tsx` — sidebar + header shell, routes between `EmptyState` / `ScanProgressPanel` / `ExploreView` based on `useLibraryStore`.
- `stores/ui.ts` — Zustand with `persist` middleware (`localStorage` key `serendip-ui`). Holds `theme` + `exploreMode`; on rehydrate it writes `data-theme` to `documentElement` so Tailwind theme variables in `assets/main.css` apply before first paint.
- `stores/library.ts` — Zustand (not persisted). `startScan` subscribes to `onScanProgress` (returns an unsubscribe), invokes `scanRoot`, then `loadStats` on completion.
- `views/Explore.tsx` — masonry layout via `react-photo-album`. Pulls 30 recommendations at a time, dedupes by id with `seenIdsRef`, infinite-scrolls via `react-intersection-observer` with a 600px rootMargin. Treats two consecutive empty batches as "no more" — the recommender naturally returns fewer items as cooldowns saturate.
- `components/MediaCard.tsx` — renders `serendip://thumb/<id>` images, hover-plays videos via `serendip://video/<id>`, calls `setLiked` / `setDisliked`.

### Conventions worth matching

- All cross-process strings go through `IPC.*` constants — never hardcode channel names.
- Use `ESCAPE '\\'` whenever doing `path LIKE ? || '%'` against DB paths; `escapeLike()` helpers exist in scanner and recommender — copy that pattern, Windows paths contain `\` which collides with the default escape.
- DB writes that touch many rows should use `db.transaction(...)` (see `insertBatch` in scanner) — orders-of-magnitude faster than per-row.
- Renderer never reads files directly; it only ever pulls bytes via `serendip://thumb/...` or `serendip://video/...`. If you need a new media-bytes endpoint, add it to `protocol.ts`, not as a new IPC call returning buffers.
- `README.md` lists some libraries (masonic, @dnd-kit, React 19) that are aspirational/early-phase. The actual installed deps in `package.json` are the ground truth — currently React 18.3 + `react-photo-album` for the masonry. Don't trust the README's stack list when in doubt.
