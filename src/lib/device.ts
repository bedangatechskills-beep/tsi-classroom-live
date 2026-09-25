const STORAGE_KEY = 'tsi-cl-device'

let memorySecret: string | null = null

function randomHex(bytes: number): string {
  const buf = new Uint8Array(bytes)
  crypto.getRandomValues(buf)
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** A per-device secret (32 random bytes, hex) that identifies a student in a room. */
export function getDeviceSecret(): string {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored && /^[0-9a-f]{64}$/.test(stored)) return stored
    const secret = randomHex(32)
    localStorage.setItem(STORAGE_KEY, secret)
    return secret
  } catch {
    // Private mode or blocked storage: keep it for this tab only.
    memorySecret ??= randomHex(32)
    return memorySecret
  }
}
