import { WEBP_QUALITY } from '@/config'
import sharp from 'sharp'

export type WebpResult = {
  buffer: Buffer
  width?: number
  height?: number
  size: number
}

export async function toWebp(input: Buffer): Promise<WebpResult> {
  const instance = sharp(input, { failOn: 'none' })
  const { width, height } = await instance.metadata()
  const buffer = await instance.webp({ quality: WEBP_QUALITY }).toBuffer()
  return { buffer, width, height, size: buffer.length }
}

export async function resizeImage(
  input: Buffer,
  maxWidth: number,
  maxHeight: number,
): Promise<WebpResult> {
  const instance = sharp(input, { failOn: 'none' }).rotate()
  const metadata = await instance.metadata()

  if (!metadata.width || !metadata.height) {
    throw new Error('Unable to determine image dimensions')
  }

  const aspectRatio = metadata.width / metadata.height
  let targetWidth = metadata.width
  let targetHeight = metadata.height

  if (metadata.width > maxWidth) {
    targetWidth = maxWidth
    targetHeight = Math.round(maxWidth / aspectRatio)
  }

  if (targetHeight > maxHeight) {
    targetHeight = maxHeight
    targetWidth = Math.round(maxHeight * aspectRatio)
  }

  const buffer = await instance
    .resize(targetWidth, targetHeight, { fit: 'inside' })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer()

  return {
    buffer,
    width: targetWidth,
    height: targetHeight,
    size: buffer.length,
  }
}
