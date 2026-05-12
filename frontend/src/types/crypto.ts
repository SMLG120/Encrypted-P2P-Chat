/**
 * Cryptographic type definitions.
 * All key material is represented as base64url strings for transport.
 * Private keys exist ONLY in IndexedDB and memory — never serialized to server.
 */

export interface IdentityKeyPair {
  /** X25519 key pair for Diffie-Hellman */
  dhPublicKey: string;    // base64url
  dhPrivateKey: CryptoKey; // stays in memory / IndexedDB
  /** Ed25519 key pair for signatures */
  signingPublicKey: string;   // base64url
  signingPrivateKey: CryptoKey; // stays in memory / IndexedDB
}

export interface SignedPrekey {
  keyId: number;
  publicKey: string;   // base64url X25519
  privateKey: CryptoKey;
  signature: string;   // base64url Ed25519 signature over publicKey
}

export interface OneTimePrekey {
  keyId: number;
  publicKey: string;   // base64url X25519
  privateKey: CryptoKey;
}

export interface KeyBundle {
  userId: string;
  identityPublicKey: string;
  signingPublicKey: string;
  signedPrekey: {
    keyId: number;
    publicKey: string;
    signature: string;
  };
  oneTimePrekey?: {
    keyId: number;
    publicKey: string;
  };
}

export interface X3DHResult {
  sharedSecret: CryptoKey;
  ephemeralPublicKey: string;  // base64url
  usedOPKId?: number;
  usedSPKId: number;
}

export interface RatchetState {
  rootKey: CryptoKey;
  sendingChainKey: CryptoKey | null;
  receivingChainKey: CryptoKey | null;
  sendingRatchetKey: CryptoKeyPair | null;
  receivingRatchetKey: string | null;  // remote's public key
  sendCount: number;
  receiveCount: number;
  prevSendCount: number;
  skippedMessageKeys: Map<string, CryptoKey>;
}

export interface EncryptedMessage {
  ciphertext: string;       // base64url
  nonce: string;            // base64url
  encryptedHeader?: string; // base64url (ratchet header, encrypted)
  algorithm: string;
}

export interface DecryptedMessage {
  plaintext: string;
  senderId: string;
  timestamp: number;
}

export interface StoredKeyMaterial {
  identityKeyPair: {
    dhPublicKey: string;
    dhPrivateKeyJwk: JsonWebKey;
    signingPublicKey: string;
    signingPrivateKeyJwk: JsonWebKey;
  };
  signedPrekeys: Array<{
    keyId: number;
    publicKey: string;
    privateKeyJwk: JsonWebKey;
    signature: string;
  }>;
  oneTimePrekeys: Array<{
    keyId: number;
    publicKey: string;
    privateKeyJwk: JsonWebKey;
  }>;
}

export interface SessionKeys {
  roomId: string;
  ratchetState: SerializedRatchetState;
  createdAt: number;
}

export interface SerializedRatchetState {
  rootKeyJwk: JsonWebKey;
  sendingChainKeyJwk?: JsonWebKey;
  receivingChainKeyJwk?: JsonWebKey;
  sendingRatchetKeyPrivateJwk?: JsonWebKey;
  sendingRatchetKeyPublic?: string;
  receivingRatchetKeyPublic?: string;
  sendCount: number;
  receiveCount: number;
  prevSendCount: number;
  skippedMessageKeys: Array<{ key: string; valueJwk: JsonWebKey }>;
}
