import path from 'node:path'

export const STORAGE_ROOT = path.resolve(process.cwd(), 'src/storage/uploads')
export const DEFAULT_SUBDIR = 'misc' // fallback folder
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024 // 10MB (tune as needed)

export const IMAGE_MIME_WHITELIST = new Set([
  'image/webp',
  'image/jpeg',
  'image/png',
  'image/avif',
  'image/jpg',
])

export const WEBP_QUALITY = 82 // good balance

export const DEFAULT_DATE_FORMAT = 'YYYY-MM-DD'
export const DEFAULT_DATETIME_FORMAT = 'YYYY-MM-DD HH:mm:ss'
export const JAKARTA_TZ = 'Asia/Jakarta'

export const ADMIN_PROFILE_SUBDIR = 'admin-profiles'
export const COURT_SUBDIR = 'courts'
