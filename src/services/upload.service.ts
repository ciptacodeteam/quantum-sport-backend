import {
  DEFAULT_SUBDIR,
  IMAGE_MIME_WHITELIST,
  MAX_FILE_SIZE_BYTES,
} from '@/config'
import { env } from '@/env'
import { sniffImageMime } from '@/helpers/sniff-mime'
import { toWebp } from '@/lib/image'
import { log } from '@/lib/logger'
import { put } from '@vercel/blob'
import { extension as extFromMime } from 'mime-types'
import fs from 'node:fs/promises'
import path from 'node:path'
import { buildFilename } from '../lib/filename'
import { ensureDir, safeJoin } from '../lib/fs'

export type UploadOptions = {
  subdir?: string // e.g. "images", "avatars/2025/10"
  filenamePrefix?: string
  forceWebpForImages?: boolean // default true
  allowNonImages?: boolean // default true (won't convert)
  replaceExisting?: boolean // default false (wx flag)
  unoptimized?: boolean // default false (skip image optimization)
}

export type UploadMeta = {
  originalName?: string
  mime: string
  size: number
  isImage: boolean
  relativePath: string // e.g. images/abc.webp
  absolutePath: string // full disk path
  width?: number
  height?: number
}

export async function uploadFile(
  file: File,
  opts: UploadOptions = {},
): Promise<UploadMeta> {
  const subdir = (opts.subdir ?? DEFAULT_SUBDIR)
    .replace(/^\/+/, '')
    .replace(/\.\./g, '')
  const allowNonImages = opts.allowNonImages ?? false
  const forceWebpForImages = opts.forceWebpForImages ?? true
  const replaceExisting = opts.replaceExisting ?? true

  // Read into memory (consider streaming for huge files)
  if (file.size > MAX_FILE_SIZE_BYTES) {
    throw new Error(
      `File too large. Max ${Math.floor(MAX_FILE_SIZE_BYTES / (1024 * 1024))}MB`,
    )
  }

  const ab = await file.arrayBuffer()
  const buf = Buffer.from(new Uint8Array(ab))

  // Try detect from magic bytes (our sniffer), fallback to request Content-Type
  const sniffMime = sniffImageMime(buf) ?? (file.type || '')
  const isImage = IMAGE_MIME_WHITELIST.has(sniffMime)

  if (!isImage && !allowNonImages) {
    throw new Error('Only images are allowed')
  }

  // Prepare folder
  const dir = safeJoin(subdir)

  if (env.nodeEnv !== 'production') {
    await ensureDir(dir)
  }

  let outBuf = buf
  let outExt = ''
  let width: number | undefined
  let height: number | undefined

  if (isImage && forceWebpForImages && !opts.unoptimized) {
    const webp = await toWebp(buf)
    outBuf = Buffer.from(webp.buffer)
    width = webp.width
    height = webp.height
    outExt = '.webp'
  } else {
    // keep original extension if present; otherwise derive from mime
    const extFromName = (file.name.match(/\.[^.]+$/)?.[0] ?? '').toLowerCase()
    const extFromSniff = sniffMime ? `.${extFromMime(sniffMime) || ''}` : ''
    outExt = extFromName || extFromSniff || ''
  }

  const filename = buildFilename({
    origName: file.name,
    forceExt: outExt || '.bin',
    prefix: opts.filenamePrefix,
  })

  const absolutePath = path.join(dir, filename)
  const relativePath = path.join(subdir, filename).replaceAll('\\', '/')
  const finalMime =
    isImage && forceWebpForImages && !opts.unoptimized
      ? 'image/webp'
      : sniffMime || 'application/octet-stream'

  // Upload to Vercel Blob if token is available
  if (env.nodeEnv === 'production' && env.BLOB_READ_WRITE_TOKEN) {
    try {
      const blob = await put(relativePath, outBuf, {
        access: 'public',
        token: env.BLOB_READ_WRITE_TOKEN,
        contentType: finalMime,
        addRandomSuffix: false,
      })

      return {
        originalName: file.name,
        mime: finalMime,
        size: outBuf.length,
        isImage,
        relativePath: blob.pathname, // Store just the path (e.g., /banners/file.webp)
        absolutePath: blob.url, // Store full URL for direct access if needed
        width,
        height,
      }
    } catch (error) {
      log.error(`Failed to upload to Vercel Blob: ${error}`)
      // Fall back to local storage if Vercel Blob upload fails
    }
  }

  // Fallback to local file storage
  const writeFlag = replaceExisting ? 'w' : 'wx'
  await fs.writeFile(absolutePath, outBuf, { flag: writeFlag })

  return {
    originalName: file.name,
    mime: finalMime,
    size: outBuf.length,
    isImage,
    relativePath, // example: subdir/filename.webp
    absolutePath, // example: /full/path/to/storage/uploads/subdir/filename.webp
    width,
    height,
  }
}

export async function deleteFile(relativePath: string): Promise<boolean> {
  const fullPath = safeJoin(relativePath)
  try {
    await fs.access(fullPath)
    await fs.unlink(fullPath)
    return true
  } catch (err) {
    log.error(`Failed to delete file: ${err}`)
    return false
  }
}

export async function getFileUrl(relativePath: string | null): Promise<string> {
  if (!relativePath) {
    return ''
  }

  // If already a full URL, return as-is
  if (
    relativePath.startsWith('http://') ||
    relativePath.startsWith('https://')
  ) {
    return relativePath
  }

  // If path starts with '/', try to construct Vercel Blob URL first (if token exists)
  if (env.nodeEnv === 'production' && env.BLOB_READ_WRITE_TOKEN) {
    // The token format is: vercel_blob_rw_<storeId>_<randomString>
    const parts = env.BLOB_READ_WRITE_TOKEN.split('_')
    if (parts.length >= 4) {
      const storeId = parts[3] // Extract store ID from token
      return `https://${storeId}.public.blob.vercel-storage.com${relativePath}`
    }
  }

  // Fallback to local file system check
  const fullPath = safeJoin(relativePath)
  try {
    await fs.access(fullPath)
    return `${env.baseUrl}/storage/uploads${relativePath.startsWith('/') ? '' : '/'}${relativePath}`
  } catch {
    throw new Error('File not found')
  }
}
