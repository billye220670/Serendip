import sharp from 'sharp'
import ffmpeg from 'fluent-ffmpeg'
import ffmpegStatic from 'ffmpeg-static'
import ffprobeStatic from '@ffprobe-installer/ffprobe'
import { createHash } from 'crypto'
import { mkdir, access } from 'fs/promises'
import { join, dirname } from 'path'
import { existsSync } from 'fs'

// 设置 ffmpeg / ffprobe 路径（打包好的二进制）
if (ffmpegStatic) {
  ffmpeg.setFfmpegPath(ffmpegStatic)
}
if (ffprobeStatic?.path) {
  ffmpeg.setFfprobePath(ffprobeStatic.path)
}

const THUMB_WIDTH = 320
const THUMB_QUALITY = 80

/**
 * 为图片生成缩略图，并返回原图宽高
 * @param sourcePath 原图路径
 * @param cacheDir 缓存目录（.serendip-cache/thumbs）
 * @returns { thumbPath, width, height }
 */
export async function generateImageThumb(
  sourcePath: string,
  cacheDir: string
): Promise<{ thumbPath: string; width: number; height: number }> {
  const hash = hashPath(sourcePath)
  const thumbRelPath = `${hash}.webp`
  const thumbAbsPath = join(cacheDir, thumbRelPath)

  // 用 sharp 拿元数据 + 生成缩略图
  const pipeline = sharp(sourcePath, { failOn: 'none' })
  const metadata = await pipeline.metadata()
  const width = metadata.width ?? 1
  const height = metadata.height ?? 1

  // 如果缩略图已存在，跳过生成
  if (!existsSync(thumbAbsPath)) {
    await mkdir(dirname(thumbAbsPath), { recursive: true })
    await pipeline
      .rotate() // 自动按 EXIF 旋转
      .resize(THUMB_WIDTH, null, { withoutEnlargement: true })
      .webp({ quality: THUMB_QUALITY })
      .toFile(thumbAbsPath)
  }

  return { thumbPath: thumbRelPath, width, height }
}

/**
 * 为视频生成缩略图（抽取中间帧），并返回原视频宽高与时长
 * @param sourcePath 原视频路径
 * @param cacheDir 缓存目录
 */
export async function generateVideoThumb(
  sourcePath: string,
  cacheDir: string
): Promise<{ thumbPath: string; durationMs: number; width: number; height: number }> {
  const hash = hashPath(sourcePath)
  const thumbRelPath = `${hash}.webp`
  const thumbAbsPath = join(cacheDir, thumbRelPath)

  // 一次 ffprobe 同时拿时长 + 宽高
  const meta = await probeVideo(sourcePath)

  if (existsSync(thumbAbsPath)) {
    return { thumbPath: thumbRelPath, ...meta }
  }

  await mkdir(dirname(thumbAbsPath), { recursive: true })

  // 抽取中间帧
  const seekTime = Math.max(0, meta.durationMs / 2000) // 秒

  return new Promise((resolve, reject) => {
    ffmpeg(sourcePath)
      .seekInput(seekTime)
      .frames(1)
      .size(`${THUMB_WIDTH}x?`)
      .outputOptions(['-q:v', '2'])
      .output(thumbAbsPath)
      .on('end', () => {
        resolve({ thumbPath: thumbRelPath, ...meta })
      })
      .on('error', (err) => {
        reject(new Error(`Failed to generate video thumb: ${err.message}`))
      })
      .run()
  })
}

/**
 * 一次 ffprobe 拿到视频的时长 + 宽高
 */
function probeVideo(
  videoPath: string
): Promise<{ durationMs: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        reject(new Error(`Failed to probe video: ${err.message}`))
        return
      }
      const durationSec = metadata.format.duration ?? 0
      const videoStream = metadata.streams.find((s) => s.codec_type === 'video')
      const width = videoStream?.width ?? 1
      const height = videoStream?.height ?? 1
      resolve({
        durationMs: Math.round(durationSec * 1000),
        width,
        height
      })
    })
  })
}

/**
 * 路径哈希（用作缩略图文件名）
 */
function hashPath(path: string): string {
  return createHash('sha256').update(path).digest('hex').substring(0, 16)
}

/**
 * 确保缓存目录存在
 */
export async function ensureCacheDir(cacheDir: string): Promise<void> {
  try {
    await access(cacheDir)
  } catch {
    await mkdir(cacheDir, { recursive: true })
  }
}
