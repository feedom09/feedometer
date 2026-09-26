/**
 * workers/lib/crypto.js — Edge WebCrypto utilities for authentication & article identity
 */

export async function sha256Hex(data) {
  const encoder = new TextEncoder();
  const buffer = await crypto.subtle.digest('SHA-256', encoder.encode(data));
  return bufferToHex(buffer);
}

export function generateRandomHex(bytes = 32) {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function bufferToHex(buffer) {
  const arr = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function hexToBytes(hex) {
  const clean = (hex || '').replace(/[^0-9a-f]/gi, '');
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return out;
}

function timingSafeEqualHex(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

const PBKDF2_ITERATIONS = 100000;

async function derivePbkdf2Hex(password, saltBytes, iterations) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: saltBytes,
      iterations,
      hash: 'SHA-256'
    },
    key,
    256
  );
  return bufferToHex(bits);
}

export async function hashPassword(password) {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const hashHex = await derivePbkdf2Hex(password, saltBytes, PBKDF2_ITERATIONS);
  return `pbkdf2:${PBKDF2_ITERATIONS}:${bufferToHex(saltBytes)}:${hashHex}`;
}

export async function verifyPassword(password, storedPasswordHash) {
  if (!storedPasswordHash || !password) return false;

  if (storedPasswordHash.startsWith('pbkdf2:')) {
    const parts = storedPasswordHash.split(':');
    if (parts.length !== 4) return false;
    const iterations = parseInt(parts[1], 10) || PBKDF2_ITERATIONS;
    const saltHex = parts[2];
    const expected = parts[3];
    const actual = await derivePbkdf2Hex(password, hexToBytes(saltHex), iterations);
    return timingSafeEqualHex(actual, expected);
  }

  // Legacy salted SHA-256: salt:hash
  if (!storedPasswordHash.includes(':')) return false;
  const [salt, expectedHash] = storedPasswordHash.split(':');
  const actualHash = await sha256Hex(`${salt}:${password}`);
  return timingSafeEqualHex(actualHash, expectedHash);
}
