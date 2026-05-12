/**
 * Identity key generation and bundle preparation.
 *
 * Generates the full X3DH key material:
 *  - IK: long-term X25519 identity key (DH) + Ed25519 signing key
 *  - SPK: medium-term signed prekey (X25519, signed with Ed25519)
 *  - OPKs: batch of one-time prekeys (X25519)
 *
 * All private keys are stored ONLY in IndexedDB via keyStore.
 * Only public keys are uploaded to the server.
 */

import {
  generateX25519KeyPair,
  generateEd25519KeyPair,
  ed25519Sign,
  ed25519Verify,
} from "./primitives";
import { bytesToB64url, b64urlToBytes } from "@/lib/base64";

export interface GeneratedIdentity {
  // Public (sent to server)
  identityPublicKey: string;   // base64url X25519
  signingPublicKey: string;    // base64url Ed25519

  // Private (stored locally ONLY)
  identityPrivateKey: Uint8Array;
  signingPrivateKey: Uint8Array;
}

export interface GeneratedSignedPrekey {
  keyId: number;
  publicKey: string;
  signature: string;
  privateKey: Uint8Array;
}

export interface GeneratedOneTimePrekey {
  keyId: number;
  publicKey: string;
  privateKey: Uint8Array;
}

export function generateIdentity(): GeneratedIdentity {
  const dhPair = generateX25519KeyPair();
  const sigPair = generateEd25519KeyPair();

  return {
    identityPublicKey: bytesToB64url(dhPair.publicKey),
    signingPublicKey: bytesToB64url(sigPair.publicKey),
    identityPrivateKey: dhPair.privateKey,
    signingPrivateKey: sigPair.privateKey,
  };
}

export function generateSignedPrekey(
  keyId: number,
  signingPrivateKey: Uint8Array
): GeneratedSignedPrekey {
  const { privateKey, publicKey } = generateX25519KeyPair();
  const signature = ed25519Sign(signingPrivateKey, publicKey);

  return {
    keyId,
    publicKey: bytesToB64url(publicKey),
    signature: bytesToB64url(signature),
    privateKey,
  };
}

export function generateOneTimePrekeys(
  count: number,
  startKeyId: number = 0
): GeneratedOneTimePrekey[] {
  return Array.from({ length: count }, (_, i) => {
    const { privateKey, publicKey } = generateX25519KeyPair();
    return {
      keyId: startKeyId + i,
      publicKey: bytesToB64url(publicKey),
      privateKey,
    };
  });
}

export function verifySignedPrekey(
  signingPublicKey: string,
  prekey: { publicKey: string; signature: string }
): boolean {
  try {
    return ed25519Verify(
      b64urlToBytes(signingPublicKey),
      b64urlToBytes(prekey.publicKey),
      b64urlToBytes(prekey.signature)
    );
  } catch {
    return false;
  }
}

/**
 * Build the key bundle upload payload for the server.
 * Only public key material is included.
 */
export function buildKeyBundleUpload(
  identity: GeneratedIdentity,
  signedPrekey: GeneratedSignedPrekey,
  oneTimePrekeys: GeneratedOneTimePrekey[]
) {
  return {
    identity: {
      identity_public_key: identity.identityPublicKey,
      signing_public_key: identity.signingPublicKey,
    },
    signed_prekey: {
      key_id: signedPrekey.keyId,
      public_key: signedPrekey.publicKey,
      signature: signedPrekey.signature,
    },
    one_time_prekeys: oneTimePrekeys.map((opk) => ({
      key_id: opk.keyId,
      public_key: opk.publicKey,
    })),
  };
}
