// Minimal, dependency-free MIME sniffer for common image formats.
export function sniffImageMime(buf: Buffer): string | null {
  if (buf.length < 12) return null

  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47 &&
    buf[4] === 0x0d &&
    buf[5] === 0x0a &&
    buf[6] === 0x1a &&
    buf[7] === 0x0a
  ) {
    return 'image/png'
  }

  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return 'image/jpeg'
  }

  // WebP: "RIFF" .... "WEBP"
  if (
    buf[0] === 0x52 &&
    buf[1] === 0x49 &&
    buf[2] === 0x46 &&
    buf[3] === 0x46 && // "RIFF"
    buf[8] === 0x57 &&
    buf[9] === 0x45 &&
    buf[10] === 0x42 &&
    buf[11] === 0x50 // "WEBP"
  ) {
    return 'image/webp'
  }

  // AVIF (ISOBMFF): bytes 4..7 = "ftyp", then brand contains "avif" or "avis"
  // structure: size(4) + "ftyp"(4) + major_brand(4) + minor_version(4) + compatible_brands(…)
  if (
    buf[4] === 0x66 &&
    buf[5] === 0x74 &&
    buf[6] === 0x79 &&
    buf[7] === 0x70
  ) {
    const brands = buf.subarray(8, 32).toString('ascii')
    if (brands.includes('avif') || brands.includes('avis')) {
      return 'image/avif'
    }
  }

  return null
}
