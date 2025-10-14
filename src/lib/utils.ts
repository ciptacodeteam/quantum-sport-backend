export async function formatPhone(phone: string) {
  // Remove spaces, dashes, and parentheses
  const cleaned = phone.replace(/[\s\-()]/g, '')

  // Handle numbers starting with '+62'
  if (cleaned.startsWith('+62')) {
    return cleaned
  }

  // Handle numbers starting with '62'
  if (cleaned.startsWith('62')) {
    return `+${cleaned}`
  }

  // Handle numbers starting with '08'
  if (cleaned.startsWith('08')) {
    return `+62${cleaned.slice(1)}`
  }

  // Default: just add '+'
  if (!cleaned.startsWith('+')) {
    return `+${cleaned}`
  }

  return cleaned
}
