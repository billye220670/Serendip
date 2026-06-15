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

import * as path from 'path'
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
  /** 仅返回 liked=0 AND disliked=0 的未评级文件（评审模式专用） */
  onlyUnrated?: boolean
  /** 限定抽样路径范围（详情页接力用）；必须在 rootPath 之下，否则忽略 */
  scopePath?: string
}

export interface HierarchicalRecommendOptions {
  folderPath: string
  rootPath: string
  count: number
  mode: ExploreMode
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
  const { count, mode, excludeIds = new Set(), onlyUnrated = false, scopePath } = options
  const db = getDatabase()

  // 模式参数
  const params = getModeParams(mode)

  // 当前根目录（限制只在该根下的文件参与抽样）
  const rootRow = db.prepare('SELECT value FROM settings WHERE key = ?').get('rootPath') as
    | { value: string }
    | undefined
  if (!rootRow) return []
  const rootPath = rootRow.value

  // scopePath 必须在 rootPath 之下，否则回退到 rootPath
  const effectiveScopePath =
    scopePath && scopePath.startsWith(rootPath) ? scopePath : rootPath
  const rootPrefix = escapeLike(effectiveScopePath)

  const unratedFilter = onlyUnrated ? ' AND liked = 0' : ''

  // 1) 取出所有文件夹及其权重（排除完全只有 disliked / unavailable 的文件夹）
  const folders = db.prepare(`
    SELECT
      folder_path as path,
      COUNT(*) as file_count,
      SUM(CASE WHEN disliked = 0 AND unavailable = 0${unratedFilter} THEN 1 ELSE 0 END) as available_count,
      MAX(IFNULL(last_shown_at, 0)) as last_shown_at
    FROM media_files
    WHERE disliked = 0
      AND unavailable = 0
      ${unratedFilter}
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
    const file = pickFileInFolder(db, folder.path, mode, excludeIds, seenInThisBatch, onlyUnrated)
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
 * 分层路径推荐：以当前路径为锚点，逐级向上层路径放宽采样
 * 权重策略：当前文件数越少，父链权重越高；最多 50% 给当前层
 */
export function getHierarchicalRecommendations(
  options: HierarchicalRecommendOptions
): MediaItem[] {
  const { folderPath, rootPath, count, mode } = options
  const db = getDatabase()

  // 查当前文件夹的文件数
  const currentFolderCount = db
    .prepare(
      'SELECT COUNT(*) as c FROM media_files WHERE folder_path = ? AND disliked = 0 AND unavailable = 0'
    )
    .get(folderPath) as { c: number } | undefined

  if (!currentFolderCount) return []
  const N = currentFolderCount.c
  if (N === 0) return []

  // 构建分层采样计划
  const plan = buildLayerPlan(folderPath, rootPath, count, N)
  if (plan.length === 0) return []

  // 逐层采样，累积 excludeIds 去重
  const allResults: MediaItem[] = []
  const excludeIds = new Set<number>()

  for (const layer of plan) {
    if (layer.count <= 0) continue

    let items: MediaItem[] = []
    if (layer.exactFolder) {
      // 当前层：精确匹配 folder_path
      items = pickFilesFromFolderExact(db, layer.scopePath, layer.count, mode, excludeIds)
    } else {
      // 父链层：用 LIKE 前缀（含子目录）
      items = recommend({
        count: layer.count,
        mode,
        excludeIds,
        scopePath: layer.scopePath
      })
    }

    // 累积到全局 excludeIds
    items.forEach((item) => excludeIds.add(item.id))
    allResults.push(...items)
  }

  // shuffle 打乱顺序（避免按层分组的视觉感）
  fisherYatesShuffle(allResults)

  return allResults.slice(0, count)
}

/**
 * 构建分层采样计划：返回每一层应采多少张
 */
function buildLayerPlan(
  folderPath: string,
  rootPath: string,
  count: number,
  currentFolderFileCount: number
): Array<{ scopePath: string; count: number; exactFolder: boolean }> {
  // 决定当前层权重（基于文件数 N）
  let currentRatio = 0.5
  const N = currentFolderFileCount
  if (N <= 2) currentRatio = 0
  else if (N <= 15) currentRatio = 0.25
  else if (N <= 50) currentRatio = 0.35
  else if (N <= 200) currentRatio = 0.45
  else currentRatio = 0.5

  // 如果已在根目录，强制当前层 100%
  if (folderPath === rootPath) {
    return [{ scopePath: folderPath, count, exactFolder: true }]
  }

  // 向上解析父链（直到根目录）
  const ancestors: string[] = []
  let p = path.dirname(folderPath)
  while (p !== folderPath) {
    ancestors.push(p)
    if (p === rootPath) break
    p = path.dirname(p)
  }

  if (ancestors.length === 0) {
    // 无父链，当前层 100%
    return [{ scopePath: folderPath, count, exactFolder: true }]
  }

  // 分配数量
  const plan: Array<{ scopePath: string; count: number; exactFolder: boolean }> = []

  const currentCount = Math.round(count * currentRatio)
  if (currentCount > 0) {
    plan.push({ scopePath: folderPath, count: currentCount, exactFolder: true })
  }

  // 父链权重：60% / 25% / 15%（递减，超过 3 层的余量归最后一层）
  const ancestorRatio = 1 - currentRatio
  const ANCESTOR_WEIGHTS = [0.6, 0.25, 0.15]

  let totalAncestorCount = 0
  for (let i = 0; i < ancestors.length; i++) {
    const w = i < ANCESTOR_WEIGHTS.length ? ANCESTOR_WEIGHTS[i] : 0
    let ancestorCount = Math.round(count * ancestorRatio * w)

    // 最后一层吸收舍入误差
    if (i === ancestors.length - 1) {
      ancestorCount = count - currentCount - totalAncestorCount
    }

    if (ancestorCount > 0) {
      plan.push({ scopePath: ancestors[i], count: ancestorCount, exactFolder: false })
      totalAncestorCount += ancestorCount
    }
  }

  return plan
}

/**
 * 从指定文件夹精确采样（folder_path = 精确匹配，不含子目录）
 */
function pickFilesFromFolderExact(
  db: ReturnType<typeof getDatabase>,
  folderPath: string,
  count: number,
  mode: ExploreMode,
  excludeIds: Set<number>
): MediaItem[] {
  const params = getModeParams(mode)

  // 读出文件夹下所有可用文件（精确 folder_path，无子目录）
  const files = db.prepare(`
    SELECT id, path, folder_path, type, width, height, duration_ms, liked, disliked,
           IFNULL(last_shown_at, 0) as last_shown_at,
           shown_count
    FROM media_files
    WHERE folder_path = ? AND disliked = 0 AND unavailable = 0
  `).all(folderPath) as Array<MediaItem & { last_shown_at: number; shown_count: number }>

  const available = files.filter((f) => !excludeIds.has(f.id))
  if (available.length === 0) return []

  const results: MediaItem[] = []
  const now = Date.now()

  // 加权采样，防止重复
  const seenInThisBatch = new Set<number>()

  for (let i = 0; i < count * 3 && results.length < count; i++) {
    let totalWeight = 0
    const weights: number[] = []

    for (const f of available) {
      if (seenInThisBatch.has(f.id)) continue

      let w = 1
      if (f.liked) w *= params.likedBoost
      const sinceLastShownSec = f.last_shown_at > 0 ? (now - f.last_shown_at) / 1000 : Infinity
      w *= computeCooldown(sinceLastShownSec, params.fileCooldownHalfLifeSec)
      w *= 1 / Math.pow(1 + f.shown_count, params.shownCountPenalty)
      weights.push(w)
      totalWeight += w
    }

    if (totalWeight <= 0) break

    let r = Math.random() * totalWeight
    let picked: MediaItem | null = null
    let filterIndex = 0

    for (let j = 0; j < available.length; j++) {
      if (seenInThisBatch.has(available[j].id)) continue
      r -= weights[filterIndex]
      if (r <= 0) {
        picked = available[j]
        break
      }
      filterIndex++
    }

    if (picked) {
      seenInThisBatch.add(picked.id)
      const pickedTyped = picked as MediaItem & { last_shown_at: number; shown_count: number }
      const { last_shown_at: _l, shown_count: _s, ...rest } = pickedTyped
      results.push(rest as MediaItem)
    }
  }

  // 更新 shown_count
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
  seenInBatch: Set<number>,
  onlyUnrated: boolean
): MediaItem | null {
  const params = getModeParams(mode)
  const unratedFilter = onlyUnrated ? ' AND liked = 0' : ''
  // 读出文件夹下所有可用文件（不含 disliked / unavailable）
  const files = db.prepare(`
    SELECT id, path, folder_path, type, width, height, duration_ms, liked, disliked,
           IFNULL(last_shown_at, 0) as last_shown_at,
           shown_count
    FROM media_files
    WHERE folder_path = ? AND disliked = 0 AND unavailable = 0${unratedFilter}
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

/** Fisher-Yates 随机打乱 */
function fisherYatesShuffle<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
}
