/**
 * Decodes file bytes as UTF-8 and strips a leading BOM. Returns `null` when the bytes are not valid UTF-8 (for
 * example a Windows-1251 export), so the wizard can ask for a UTF-8 file (UC-10 3a).
 */
export function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    // `ignoreBOM: false` (the default) drops the BOM.
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return null
  }
}

export function isValidUtf8(bytes: Uint8Array): boolean {
  return decodeUtf8(bytes) !== null
}
