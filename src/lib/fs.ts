import { STORAGE_ROOT } from '@/config'
import fs from 'node:fs/promises'
import path from 'node:path'

export async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true })
}

/**
 * Join paths safely within STORAGE_ROOT. Rejects attempts to escape root.
 */
export function safeJoin(...segments: string[]) {
  const joined = path.join(STORAGE_ROOT, ...segments)
  const normalized = path.normalize(joined)
  if (!normalized.startsWith(STORAGE_ROOT)) {
    throw new Error('Unsafe path')
  }
  return normalized
}
