// src/security/passwords-argon2.ts
import { env } from '@/env'
import argon2 from 'argon2'
import { randomBytes } from 'crypto'

/**
 * Tweak these to match your hardware & latency budget.
 * memoryCost is in KiB (e.g. 65536 KiB = 64 MiB).
 */
const ARGON2_OPTS: argon2.Options & { secret?: Buffer } = {
  type: argon2.argon2id,
  memoryCost: 64 * 1024, // 64 MiB
  timeCost: 3, // iterations
  parallelism: 1,
  hashLength: 32,
  // Optional pepper: keep it in an env var, rotate with care.
  secret: env.PWD_PEPPER ? Buffer.from(env.PWD_PEPPER, 'utf8') : undefined,
}

/**
 * Hash a password with Argon2id.
 * Returns a PHC-formatted string, e.g. $argon2id$v=19$m=65536,t=3,p=1$<salt>$<hash>
 */
export async function hashPassword(password: string): Promise<string> {
  // (Optional) add per-user random salt manually – argon2 will generate one if omitted.
  // Keeping it explicit for clarity:
  const salt = randomBytes(16) // 128-bit salt
  return argon2.hash(password, { ...ARGON2_OPTS, salt })
}

/**
 * Verify a password against a stored Argon2 hash (PHC format).
 * Constant-time under the hood.
 */
export async function verifyPassword(
  password: string,
  storedHash: string,
): Promise<boolean> {
  try {
    return await argon2.verify(storedHash, password, ARGON2_OPTS)
  } catch {
    return false
  }
}

/**
 * Decide if the stored hash should be upgraded (e.g., after you raise memoryCost/timeCost).
 * If true, re-hash the user's password at next successful login.
 */
export function needsRehash(storedHash: string): boolean {
  try {
    return argon2.needsRehash(storedHash, ARGON2_OPTS)
  } catch {
    // If parse fails (unknown format), force a rehash on next login.
    return true
  }
}
