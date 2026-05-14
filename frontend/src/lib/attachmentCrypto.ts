import { b64urlToBytes, bytesToB64url } from "@/lib/base64";

function toBufferSource(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy;
}

async function importRawKey(keyB64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    toBufferSource(b64urlToBytes(keyB64)),
    { name: "AES-GCM" },
    false,
    ["decrypt"]
  );
}

export async function encryptAttachmentFile(file: File): Promise<{
  blob: Blob;
  key: string;
  nonce: string;
}> {
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = await file.arrayBuffer();
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toBufferSource(nonce) },
    key,
    plaintext
  );
  const rawKey = await crypto.subtle.exportKey("raw", key);
  return {
    blob: new Blob([ciphertext], { type: "application/octet-stream" }),
    key: bytesToB64url(new Uint8Array(rawKey)),
    nonce: bytesToB64url(nonce),
  };
}

export async function decryptAttachmentBlob(
  encryptedBlob: Blob,
  keyB64: string,
  nonceB64: string,
  mimeType: string
): Promise<Blob> {
  const key = await importRawKey(keyB64);
  const ciphertext = await encryptedBlob.arrayBuffer();
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toBufferSource(b64urlToBytes(nonceB64)) },
    key,
    ciphertext
  );
  return new Blob([plaintext], { type: mimeType });
}
