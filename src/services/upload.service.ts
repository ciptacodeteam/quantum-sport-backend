import {
  DEFAULT_SUBDIR,
  IMAGE_MIME_WHITELIST,
  MAX_FILE_SIZE_BYTES,
} from '@/config'
import { env } from '@/env'
import { sniffImageMime } from '@/helpers/sniff-mime'
import { toWebp } from '@/lib/image'
import { log } from '@/lib/logger'
import { del, put } from '@vercel/blob'
import { extension as extFromMime } from 'mime-types'
import path from 'node:path'
import { buildFilename } from '../lib/filename'

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

// Cache for Vercel Blob base URL (extracted from first upload)
let blobBaseUrl: string | null = null

export async function uploadFile(
  file: File,
  opts: UploadOptions = {},
): Promise<UploadMeta> {
  const subdir = (opts.subdir ?? DEFAULT_SUBDIR)
    .replace(/^\/+/, '')
    .replace(/\.\./g, '')
  const allowNonImages = opts.allowNonImages ?? false
  const forceWebpForImages = opts.forceWebpForImages ?? true
  // const replaceExisting = opts.replaceExisting ?? true

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

  const relativePath = path.join(subdir, filename).replaceAll('\\', '/')
  const finalMime =
    isImage && forceWebpForImages && !opts.unoptimized
      ? 'image/webp'
      : sniffMime || 'application/octet-stream'

  // Upload to Vercel Blob Storage
  if (!env.blobToken) {
    throw new Error('BLOB_READ_WRITE_TOKEN is required for file uploads')
  }

  try {
    const blob = await put(relativePath, outBuf, {
      access: 'public',
      token: env.blobToken,
      contentType: finalMime,
      addRandomSuffix: false,
    })

    // Cache the base URL from the first upload
    if (!blobBaseUrl && blob.url) {
      // Extract base URL (everything before the pathname)
      const url = new URL(blob.url)
      blobBaseUrl = `${url.protocol}//${url.host}`
      log.info(`Cached Vercel Blob base URL: ${blobBaseUrl}`)
    }

    return {
      originalName: file.name,
      mime: finalMime,
      size: outBuf.length,
      isImage,
      relativePath: blob.pathname, // Store just the path (e.g., /banners/file.webp)
      absolutePath: blob.url, // Store full URL for reference
      width,
      height,
    }
  } catch (error) {
    log.error(`Failed to upload to Vercel Blob: ${error}`)
    throw new Error('File upload failed. Please try again.')
  }
}

export async function deleteFile(fileUrl: string): Promise<boolean> {
  if (!fileUrl) {
    return false
  }

  // Only delete if it's a Vercel Blob URL
  if (!fileUrl.startsWith('https://') && !fileUrl.startsWith('http://')) {
    log.warn(`Cannot delete non-URL file reference: ${fileUrl}`)
    return false
  }

  if (!env.blobToken) {
    log.error('BLOB_READ_WRITE_TOKEN is required to delete files')
    return false
  }

  try {
    await del(fileUrl, {
      token: env.blobToken,
    })
    log.info(`Successfully deleted file: ${fileUrl}`)
    return true
  } catch (err) {
    log.error(`Failed to delete file from Vercel Blob: ${err}`)
    return false
  }
}

export async function getFileUrl(relativePath: string | null): Promise<string> {
  if (!relativePath) {
    return ''
  }

  // If already a full URL (external or legacy), return as-is
  if (
    relativePath.startsWith('http://') ||
    relativePath.startsWith('https://')
  ) {
    return relativePath
  }

  const cleanPath = relativePath.startsWith('/')
    ? relativePath
    : `/${relativePath}`

  // Prefer the base URL learned from a real upload in this process — it's the
  // authoritative host returned by Vercel Blob.
  if (blobBaseUrl) {
    return `${blobBaseUrl}${cleanPath}`
  }

  // Otherwise derive the public host from the blob token.
  // Token format: vercel_blob_rw_<STORE_ID>_<SECRET>
  // Public host:  https://<STORE_ID>.public.blob.vercel-storage.com
  if (env.blobToken) {
    const storeId = env.blobToken.split('_')[3]
    if (storeId) {
      const host = `${storeId.toLowerCase()}.public.blob.vercel-storage.com`
      return `https://${host}${cleanPath}`
    }
  }

  // Fallback: return the path as-is
  // This will happen on the first request before any upload
  log.warn(`No blob base URL available yet for path: ${relativePath}`)
  return `${env.baseUrl}/storage${cleanPath}`
}
