import {
  DEFAULT_SUBDIR,
  IMAGE_MIME_WHITELIST,
  MAX_FILE_SIZE_BYTES,
} from '@/config'
import { sniffImageMime } from '@/helpers/sniff-mime'
import { toWebp } from '@/lib/image'
import { log } from '@/lib/logger'
import { extension as extFromMime } from 'mime-types'
import fs from 'node:fs/promises'
import path from 'node:path'
import { buildFilename } from '../lib/filename'
import { ensureDir, safeJoin } from '../lib/fs'
import { env } from '@/env'

export type UploadOptions = {
  subdir?: string // e.g. "images", "avatars/2025/10"
  filenamePrefix?: string
  forceWebpForImages?: boolean // default true
  allowNonImages?: boolean // default true (won't convert)
  replaceExisting?: boolean // default false (wx flag)
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
  await ensureDir(dir)

  let outBuf = buf
  let outExt = ''
  let width: number | undefined
  let height: number | undefined

  if (isImage && forceWebpForImages) {
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

  // If replaceExisting is true, use 'w' (overwrite); else use 'wx' (fail if exists)
  const writeFlag = replaceExisting ? 'w' : 'wx'
  await fs.writeFile(absolutePath, outBuf, { flag: writeFlag })

  return {
    originalName: file.name,
    mime:
      isImage && forceWebpForImages
        ? 'image/webp'
        : sniffMime || 'application/octet-stream',
    size: outBuf.length,
    isImage,
    relativePath: path.join(subdir, filename).replaceAll('\\', '/'), // example: subdir/filename.webp
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

export async function getFilePath(relativePath: string): Promise<string> {
  // Ensure relativePath is sanitized and joined safely
  const fullPath = safeJoin(relativePath)
  try {
    await fs.access(fullPath)
    return `${env.baseUrl}/storage/uploads${relativePath.startsWith('/') ? '' : '/'}${relativePath}`
  } catch {
    throw new Error('File not found')
  }
}
