/**
 * 媒体类型相关常量与工具
 */

// 第一期：主流图片格式
export const IMAGE_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.bmp',
  '.avif',
  '.heic',
  '.heif'
])

// 第一期：主流视频格式（mp4/mov/mkv/webm）
export const VIDEO_EXTENSIONS = new Set([
  '.mp4',
  '.mov',
  '.mkv',
  '.webm',
  '.m4v'
])

// 缩略图缓存目录名（放在媒体根目录下）
export const CACHE_DIR_NAME = '.serendip-cache'

export type MediaType = 'image' | 'video'

export function getMediaType(ext: string): MediaType | null {
  const lower = ext.toLowerCase()
  if (IMAGE_EXTENSIONS.has(lower)) return 'image'
  if (VIDEO_EXTENSIONS.has(lower)) return 'video'
  return null
}
