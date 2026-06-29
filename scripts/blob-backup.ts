#!/usr/bin/env bun
/**
 * Vercel Blob helpers for database backups.
 * Only touches blobs under BLOB_BACKUP_PREFIX (default: quantum-sport/db/).
 *
 * Usage:
 *   bun scripts/blob-backup.ts upload-stdin <filename>
 *   bun scripts/blob-backup.ts list
 *   bun scripts/blob-backup.ts prune [days]
 *   bun scripts/blob-backup.ts download <filename>
 */

import { del, head, list, put } from '@vercel/blob'

const PREFIX = (process.env.BLOB_BACKUP_PREFIX ?? 'quantum-sport/db').replace(
  /\/+$/,
  '',
)
const TOKEN = process.env.BLOB_READ_WRITE_TOKEN
const DEFAULT_RETENTION_DAYS = Number.parseInt(
  process.env.BACKUP_RETENTION_DAYS ?? '30',
  10,
)

function assertSafePrefix(prefix: string): void {
  if (!prefix.startsWith('quantum-sport/')) {
    console.error(
      `BLOB_BACKUP_PREFIX must start with 'quantum-sport/' (got: ${prefix})`,
    )
    process.exit(1)
  }
  if (prefix.includes('*') || prefix.includes('..')) {
    console.error('BLOB_BACKUP_PREFIX contains invalid characters')
    process.exit(1)
  }
}

function requireToken(): string {
  if (!TOKEN) {
    console.error('BLOB_READ_WRITE_TOKEN is required')
    process.exit(1)
  }
  return TOKEN
}

function pathnameFor(filename: string): string {
  const name = filename.replace(/^\/+/, '')
  const pathname = `${PREFIX}/${name}`
  if (!pathname.startsWith('quantum-sport/')) {
    console.error(`Refusing pathname outside quantum-sport/: ${pathname}`)
    process.exit(1)
  }
  return pathname
}

function listPrefix(): string {
  return `${PREFIX}/`
}

async function readStdin(): Promise<Buffer> {
  return Buffer.from(await Bun.stdin.arrayBuffer())
}

async function listAllDumpBlobs(token: string) {
  const blobs: Awaited<ReturnType<typeof list>>['blobs'] = []
  let cursor: string | undefined

  do {
    const page = await list({
      prefix: listPrefix(),
      token,
      limit: 1000,
      cursor,
    })
    blobs.push(...page.blobs.filter((blob) => blob.pathname.endsWith('.dump')))
    cursor = page.hasMore ? page.cursor : undefined
  } while (cursor)

  return blobs
}

async function cmdUploadStdin(filename: string): Promise<void> {
  const token = requireToken()
  assertSafePrefix(PREFIX)
  const pathname = pathnameFor(filename)
  const body = await readStdin()

  if (body.length === 0) {
    console.error('Empty stdin — nothing to upload')
    process.exit(1)
  }

  const blob = await put(pathname, body, {
    access: 'public',
    token,
    contentType: 'application/octet-stream',
    addRandomSuffix: false,
    allowOverwrite: false,
    multipart: body.length > 20 * 1024 * 1024,
  })

  const sizeMb = (body.length / 1024 / 1024).toFixed(2)
  console.log(`Uploaded: ${blob.pathname} (${sizeMb} MB)`)
}

async function cmdList(): Promise<void> {
  const token = requireToken()
  assertSafePrefix(PREFIX)

  const blobs = await listAllDumpBlobs(token)
  if (blobs.length === 0) {
    console.log('(no backups found)')
    return
  }

  for (const blob of blobs) {
    const sizeMb = (blob.size / 1024 / 1024).toFixed(2)
    const uploaded = new Date(blob.uploadedAt).toISOString()
    console.log(`${blob.pathname}\t${sizeMb} MB\t${uploaded}`)
  }
}

async function cmdPrune(days: number): Promise<void> {
  const token = requireToken()
  assertSafePrefix(PREFIX)

  if (!Number.isFinite(days) || days < 1) {
    console.error('Retention days must be a positive number')
    process.exit(1)
  }

  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000
  const blobs = await listAllDumpBlobs(token)
  const toDelete = blobs
    .filter((blob) => new Date(blob.uploadedAt).getTime() < cutoff)
    .map((blob) => blob.url)

  if (toDelete.length === 0) {
    console.log(`No remote backups to prune (retention: ${days} days)`)
    return
  }

  await del(toDelete, { token })
  console.log(`Pruned ${toDelete.length} backup(s) older than ${days} days`)
}

async function cmdDownload(filename: string): Promise<void> {
  const token = requireToken()
  const pathname = pathnameFor(filename)
  const meta = await head(pathname, { token })
  const response = await fetch(meta.downloadUrl)

  if (!response.ok) {
    console.error(`Failed to download ${pathname}: HTTP ${response.status}`)
    process.exit(1)
  }

  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length === 0) {
    console.error('Downloaded backup is empty')
    process.exit(1)
  }

  process.stdout.write(buffer)
}

async function main(): Promise<void> {
  const [cmd, ...args] = process.argv.slice(2)

  switch (cmd) {
    case 'upload-stdin':
      if (!args[0]) {
        console.error('Usage: upload-stdin <filename>')
        process.exit(1)
      }
      await cmdUploadStdin(args[0])
      break
    case 'list':
      await cmdList()
      break
    case 'prune':
      await cmdPrune(
        args[0] ? Number.parseInt(args[0], 10) : DEFAULT_RETENTION_DAYS,
      )
      break
    case 'download':
      if (!args[0]) {
        console.error('Usage: download <filename>')
        process.exit(1)
      }
      await cmdDownload(args[0])
      break
    default:
      console.error(
        'Usage: blob-backup.ts <upload-stdin|list|prune|download> ...',
      )
      process.exit(1)
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})
