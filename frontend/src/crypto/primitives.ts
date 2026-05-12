/**
 * Cryptographic primitives.
 *
 * All heavy lifting uses WebCrypto (native browser API) and @noble/curves
 * for X25519 and Ed25519. These are well-maintained, audited libraries.
 *
 * DISCLAIMER: The Double Ratchet implementation in this codebase is
 * educational/portfolio-grade. It follows the Signal protocol design but
 * has NOT been independently audited. Do not use for production threat models
 * requiring audited cryptography.
 */

import { ed25519, x25519 } from "@noble/curves/ed25519";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";
import { b64urlToBytes, bytesToB64url } from "@/lib/base64";

// ── AES-256-GCM ───────────────────────────────────────────────────────────────

function toWebCryptoBytes(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

export async function generateAESKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);
}

export async function aesEncrypt(
  key: CryptoKey,
  plaintext: string
): Promise<{ ciphertext: string; nonce: string }> {
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const data = new TextEncoder().encode(plaintext);
  const ciphertextBuf = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    key,
    data
  );
  return {
    ciphertext: bytesToB64url(new Uint8Array(ciphertextBuf)),
    nonce: bytesToB64url(nonce),
  };
}

export async function aesDecrypt(
  key: CryptoKey,
  ciphertext: string,
  nonce: string
): Promise<string> {
  const ct = toWebCryptoBytes(b64urlToBytes(ciphertext));
  const iv = toWebCryptoBytes(b64urlToBytes(nonce));
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key,
    ct
  );
  return new TextDecoder().decode(plaintext);
}

export async function exportAESKey(key: CryptoKey): Promise<JsonWebKey> {
  return crypto.subtle.exportKey("jwk", key);
}

export async function importAESKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey("jwk", jwk, { name: "AES-GCM" }, true, [
    "encrypt",
    "decrypt",
  ]);
}

export async function rawToAESKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", toWebCryptoBytes(raw), { name: "AES-GCM" }, true, [
    "encrypt",
    "decrypt",
  ]);
}

export async function exportAESKeyRaw(key: CryptoKey): Promise<Uint8Array> {
  const raw = await crypto.subtle.exportKey("raw", key);
  return new Uint8Array(raw);
}

// ── X25519 DH ─────────────────────────────────────────────────────────────────

export function generateX25519KeyPair(): { privateKey: Uint8Array; publicKey: Uint8Array } {
  const privateKey = x25519.utils.randomPrivateKey();
  const publicKey = x25519.getPublicKey(privateKey);
  return { privateKey, publicKey };
}

export function x25519DH(privateKey: Uint8Array, publicKey: Uint8Array): Uint8Array {
  return x25519.getSharedSecret(privateKey, publicKey);
}

// ── Ed25519 Signing ───────────────────────────────────────────────────────────

export function generateEd25519KeyPair(): { privateKey: Uint8Array; publicKey: Uint8Array } {
  const privateKey = ed25519.utils.randomPrivateKey();
  const publicKey = ed25519.getPublicKey(privateKey);
  return { privateKey, publicKey };
}

export function ed25519Sign(privateKey: Uint8Array, message: Uint8Array): Uint8Array {
  return ed25519.sign(message, privateKey);
}

export function ed25519Verify(
  publicKey: Uint8Array,
  message: Uint8Array,
  signature: Uint8Array
): boolean {
  try {
    return ed25519.verify(signature, message, publicKey);
  } catch {
    return false;
  }
}

// ── HKDF-SHA256 ───────────────────────────────────────────────────────────────

export function hkdfDerive(
  inputKeyMaterial: Uint8Array,
  salt: Uint8Array,
  info: string,
  outputLength: number
): Uint8Array {
  const infoBytes = new TextEncoder().encode(info);
  return hkdf(sha256, inputKeyMaterial, salt, infoBytes, outputLength);
}

/**
 * KDF_RK: Root key derivation (Double Ratchet §2.2)
 * Returns [newRootKey, chainKey]
 */
export function kdfRootKey(
  rootKey: Uint8Array,
  dhOutput: Uint8Array
): [Uint8Array, Uint8Array] {
  const salt = rootKey;
  const derived = hkdfDerive(dhOutput, salt, "WhisperRatchet", 64);
  return [derived.slice(0, 32), derived.slice(32, 64)];
}

/**
 * KDF_CK: Chain key derivation (Double Ratchet §2.2)
 * Returns [newChainKey, messageKey]
 */
export function kdfChainKey(chainKey: Uint8Array): [Uint8Array, Uint8Array] {
  const messageKey = hkdfDerive(chainKey, new Uint8Array(32), "WhisperMessageKey", 32);
  const newChainKey = hkdfDerive(chainKey, new Uint8Array(32), "WhisperChainKey", 32);
  return [newChainKey, messageKey];
}
