/**
 * 智能随机算法 v1
 *
 * 两级加权抽样：
 * 1. 先按权重选文件夹
 * 2. 再在文件夹内按权重选文件
 *
 * 关键点：
 * - 文件夹权重用 1/file_count^α 抑制大文件夹的虹吸效应
 * - liked / disliked / 最近显示过的文件做权重调整
 * - 探索程度 (prefer/balanced/explore) 调节"偏好"vs"探索"的强度
 */

import { getDatabase } from '../db'

export type ExploreMode = 'prefer' | 'balanced' | 'explore'

export interface MediaItem {
  id: number
  path: string
  folder_path: string
  type: 'image' | 'video'
  width: number | null
  height: number | null
  duration_ms: number | null
  liked: number
  disliked: number
}

interface RecommendOptions {
  count: number
  mode: ExploreMode
  excludeIds?: Set<number>
}

interface FolderWeight {
  path: string
  weight: number
  fileCount: number
}

/**
 * 抽取一批推荐内容
 */
export function recommend(options: RecommendOptions): MediaItem[] {
  const { count, mode, excludeIds = new Set() } = options
  const db = getDatabase()

  // 模式参数
  const params = getModeParams(mode)

  // 当前根目录（限制只在该根下的文件参与抽样）
  const rootRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('rootPath') as
    | { value: string }
    | undefined
  if (!rootRow) return []
  const rootPrefix = escapeLike(rootRow.value)

  // 1) 取出所有文件夹及其权重（排除完全只有 disliked / unavailable 的文件夹）
  const folders = db.prepare(`
    SELECT
      folder_path as path,
      COUNT(*) as file_count,
      SUM(CASE WHEN disliked = 0 AND unavailable = 0 THEN 1 ELSE 0 END) as available_count,
      MAX(IFNULL(last_shown_at, 0)) as last_shown_at
    FROM media_files
    WHERE disliked = 0
      AND unavailable = 0
      AND path LIKE ? ESCAPE '\\'
    GROUP BY folder_path
    HAVING available_count > 0
  `).all(rootPrefix + '%') as Array<{
    path: string
    file_count: number
    available_count: number
    last_shown_at: number
  }>

  if (folders.length === 0) return []

  const now = Date.now()
  const folderWeights: FolderWeight[] = folders.map((f) => {
    // 基础权重：1 / file_count^α
    const base = 1 / Math.pow(f.available_count, params.folderAlpha)
    // 冷却因子：最近被抽过的文件夹临时降权
    const sinceLastShownSec = f.last_shown_at > 0 ? (now - f.last_shown_at) / 1000 : Infinity
    const cooldown = computeCooldown(sinceLastShownSec, params.folderCooldownHalfLifeSec)
    return {
      path: f.path,
      weight: base * cooldown,
      fileCount: f.available_count
    }
  })

  // 2) 抽 count 张
  const results: MediaItem[] = []
  const seenInThisBatch = new Set<number>()

  // 用一个简单的小 cache 跟踪本批次内文件夹的局部冷却
  const localFolderShown = new Map<string, number>()

  for (let i = 0; i < count * 3 && results.length < count; i++) {
    // 选一个文件夹（带局部冷却）
    const folder = pickFolder(folderWeights, localFolderShown, params)
    if (!folder) break

    // 在该文件夹内挑一个文件
    const file = pickFileInFolder(db, folder.path, mode, excludeIds, seenInThisBatch)
    if (!file) continue

    results.push(file)
    seenInThisBatch.add(file.id)
    localFolderShown.set(folder.path, (localFolderShown.get(folder.path) ?? 0) + 1)
  }

  // 3) 更新 last_shown_at（本批次抽中的文件）
  if (results.length > 0) {
    const ids = results.map((r) => r.id)
    const placeholders = ids.map(() => '?').join(',')
    db.prepare(
      `UPDATE media_files
       SET shown_count = shown_count + 1,
           last_shown_at = ?
       WHERE id IN (${placeholders})`
    ).run(now, ...ids)
  }

  return results
}

/**
 * 加权抽取一个文件夹（带局部冷却）
 */
function pickFolder(
  folders: FolderWeight[],
  localShown: Map<string, number>,
  params: ModeParams
): FolderWeight | null {
  let totalWeight = 0
  const adjustedWeights: number[] = []

  for (const f of folders) {
    const localCount = localShown.get(f.path) ?? 0
    // 本批次内每被抽到一次，权重打折
    const localCooldown = Math.pow(params.localCooldownDecay, localCount)
    const w = f.weight * localCooldown
    adjustedWeights.push(w)
    totalWeight += w
  }

  if (totalWeight <= 0) return null

  let r = Math.random() * totalWeight
  for (let i = 0; i < folders.length; i++) {
    r -= adjustedWeights[i]
    if (r <= 0) return folders[i]
  }
  return folders[folders.length - 1]
}

/**
 * 在指定文件夹内加权挑一个文件
 */
function pickFileInFolder(
  db: ReturnType<typeof getDatabase>,
  folderPath: string,
  mode: ExploreMode,
  excludeIds: Set<number>,
  seenInBatch: Set<number>
): MediaItem | null {
  const params = getModeParams(mode)
  // 读出文件夹下所有可用文件（不含 disliked / unavailable）
  const files = db.prepare(`
    SELECT id, path, folder_path, type, width, height, duration_ms, liked, disliked,
           IFNULL(last_shown_at, 0) as last_shown_at,
           shown_count
    FROM media_files
    WHERE folder_path = ? AND disliked = 0 AND unavailable = 0
  `).all(folderPath) as Array<MediaItem & { last_shown_at: number; shown_count: number }>

  const available = files.filter(
    (f) => !excludeIds.has(f.id) && !seenInBatch.has(f.id)
  )
  if (available.length === 0) return null

  const now = Date.now()
  let totalWeight = 0
  const weights: number[] = []

  for (const f of available) {
    let w = 1
    // liked 加成
    if (f.liked) w *= params.likedBoost
    // 冷却
    const sinceLastShownSec = f.last_shown_at > 0 ? (now - f.last_shown_at) / 1000 : Infinity
    w *= computeCooldown(sinceLastShownSec, params.fileCooldownHalfLifeSec)
    // 显示次数惩罚（被抽多了适当降权，鼓励发现）
    w *= 1 / Math.pow(1 + f.shown_count, params.shownCountPenalty)
    weights.push(w)
    totalWeight += w
  }

  if (totalWeight <= 0) return null

  let r = Math.random() * totalWeight
  for (let i = 0; i < available.length; i++) {
    r -= weights[i]
    if (r <= 0) {
      const f = available[i]
      // 剥除局部字段
      const { last_shown_at: _l, shown_count: _s, ...rest } = f
      return rest as MediaItem
    }
  }
  return available[available.length - 1]
}

/**
 * 冷却函数：sinceSec 越小，返回值越接近 0；时间越长越接近 1
 * 用半衰期式衰减：returns 1 - 0.5^(sinceSec / halfLife)，再裁剪到 [0.05, 1]
 */
function computeCooldown(sinceSec: number, halfLifeSec: number): number {
  if (sinceSec === Infinity) return 1
  const decay = Math.pow(0.5, sinceSec / halfLifeSec)
  // decay=1 表示刚抽过 → 冷却到 5%
  // decay=0 表示很久没抽 → 冷却到 1
  return Math.max(0.05, 1 - decay * 0.95)
}

interface ModeParams {
  folderAlpha: number // 文件夹权重抑制系数
  folderCooldownHalfLifeSec: number
  fileCooldownHalfLifeSec: number
  likedBoost: number
  shownCountPenalty: number
  localCooldownDecay: number // 同批次内文件夹被重抽的衰减
}

function getModeParams(mode: ExploreMode): ModeParams {
  switch (mode) {
    case 'prefer':
      // 更多喜欢：偏好放大、冷却弱、文件夹平均化弱（让喜欢密集的文件夹多曝光）
      return {
        folderAlpha: 0.4,
        folderCooldownHalfLifeSec: 60,
        fileCooldownHalfLifeSec: 300,
        likedBoost: 4.0,
        shownCountPenalty: 0.1,
        localCooldownDecay: 0.6
      }
    case 'explore':
      // 更多探索：文件夹高度均权、冷却强、liked 不加成
      return {
        folderAlpha: 0.85,
        folderCooldownHalfLifeSec: 600,
        fileCooldownHalfLifeSec: 3600,
        likedBoost: 1.0,
        shownCountPenalty: 0.5,
        localCooldownDecay: 0.2
      }
    case 'balanced':
    default:
      return {
        folderAlpha: 0.6,
        folderCooldownHalfLifeSec: 180,
        fileCooldownHalfLifeSec: 1200,
        likedBoost: 2.0,
        shownCountPenalty: 0.3,
        localCooldownDecay: 0.4
      }
  }
}

/** 转义 SQL LIKE 中的特殊字符 */
function escapeLike(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')
}
