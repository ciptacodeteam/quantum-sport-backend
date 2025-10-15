import crypto from 'node:crypto'
import slugify from 'slugify'

export type FilenameOpts = {
  origName?: string // optional original file name for slug
  forceExt?: string // e.g. ".webp"
  prefix?: string // e.g. userId, "product"
}

export function randomId(n = 8) {
  return crypto.randomBytes(n).toString('hex')
}

export function buildFilename(opts: FilenameOpts = {}) {
  const ts = new Date()
    .toISOString()
    .replace(/[-:T.Z]/g, '')
    .slice(0, 14)
  const base = opts.origName
    ? slugify(opts.origName.replace(/\.[^.]+$/, ''), {
        lower: true,
        strict: true,
      })
    : 'file'
  const prefix = opts.prefix
    ? `${slugify(opts.prefix, { lower: true, strict: true })}-`
    : ''
  const ext = opts.forceExt ?? ''
  return `${prefix}${base}-${ts}-${randomId()}${ext}`
}
