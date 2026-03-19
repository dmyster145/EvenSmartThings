/**
 * Encrypt/decrypt PAT for storage so it is not stored in plaintext.
 * Uses Web Crypto API (AES-GCM + PBKDF2). Stored value is "v1." + base64(iv || ciphertext).
 * Backwards compatible: if stored value does not start with "v1.", it is treated as plaintext.
 */

const ALGORITHM = 'AES-GCM';
const KEY_ALGORITHM = 'PBKDF2';
const SALT = new TextEncoder().encode('smartthings-controls-pat-salt-v1');
const LEGACY_SALT = new TextEncoder().encode(atob('ZXZlbi1zbWFydHRoaW5ncy1wYXQtc2FsdC12MQ=='));
const ITERATIONS = 100_000;
const IV_LENGTH = 12;
const TAG_LENGTH = 128;
const PREFIX = 'v1.';

/** App-level secret used only to derive the encryption key (obfuscation at rest). */
const KEY_PASSPHRASE = 'smartthings-controls-pat-encryption-v1';
const LEGACY_KEY_PASSPHRASE = atob('ZXZlbi1zbWFydHRoaW5ncy1wYXQtZW5jcnlwdGlvbi12MQ==');

async function getKey(passphrase: string, salt: BufferSource): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    enc.encode(passphrase),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  );
  return await crypto.subtle.deriveKey(
    {
      name: KEY_ALGORITHM,
      salt,
      iterations: ITERATIONS,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: ALGORITHM, length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

function base64Encode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

function base64Decode(str: string): Uint8Array {
  const binary = atob(str);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Encrypt if Web Crypto is available; otherwise return plaintext. Use when saving so device WebViews that lack crypto.subtle still persist the token.
 */
export async function encryptPatOrPlaintext(plaintext: string): Promise<string> {
  if (!plaintext) return '';
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      return await encryptPat(plaintext);
    }
  } catch {
    // fall through to plaintext
  }
  return plaintext;
}

/**
 * Encrypt plaintext for storage. Returns a string that can be stored in bridge localStorage.
 */
export async function encryptPat(plaintext: string): Promise<string> {
  if (!plaintext) return '';
  const key = await getKey(KEY_PASSPHRASE, SALT);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv, tagLength: TAG_LENGTH },
    key,
    encoded
  );
  const combined = new Uint8Array(iv.length + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.length);
  return PREFIX + base64Encode(combined);
}

/**
 * Decrypt a value from storage. If the value is not encrypted (no "v1." prefix), returns it as-is for backwards compatibility.
 * On decryption failure (e.g. corrupted or migrated storage), returns '' and logs a warning so the app can try another storage source or show the config form.
 */
export async function decryptPat(stored: string): Promise<string> {
  if (!stored) return '';
  if (!stored.startsWith(PREFIX)) return stored;
  try {
    const combined = base64Decode(stored.slice(PREFIX.length));
    if (combined.length < IV_LENGTH) return '';
    const iv = Uint8Array.from(combined.subarray(0, IV_LENGTH));
    const ciphertext = Uint8Array.from(combined.subarray(IV_LENGTH));
    const keyCandidates: Array<{ passphrase: string; salt: BufferSource }> = [
      { passphrase: KEY_PASSPHRASE, salt: SALT },
      // Keep legacy decryption support for values encrypted before app rename.
      { passphrase: LEGACY_KEY_PASSPHRASE, salt: LEGACY_SALT },
    ];
    for (const candidate of keyCandidates) {
      try {
        const key = await getKey(candidate.passphrase, candidate.salt);
        const decrypted = await crypto.subtle.decrypt(
          { name: ALGORITHM, iv, tagLength: TAG_LENGTH },
          key,
          ciphertext
        );
        return new TextDecoder().decode(decrypted);
      } catch {
        // Try next key candidate.
      }
    }
    return '';
  } catch (err) {
    console.warn('[SmartThingsControls] PAT decryption failed (storage may be corrupted or crypto unavailable):', err);
    return '';
  }
}
