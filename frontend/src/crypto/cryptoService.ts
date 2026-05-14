/**
 * CryptoService — high-level interface for all cryptographic operations.
 *
 * This is the ONLY module that components and services should import from.
 * It orchestrates identity generation, X3DH, Double Ratchet, and key storage.
 */

import {
  generateIdentity,
  generateSignedPrekey,
  generateOneTimePrekeys,
  buildKeyBundleUpload,
} from "./identity";
import {
  x3dhInitiate,
  x3dhRespond,
} from "./x3dh";
import {
  ratchetInitAlice,
  ratchetInitBob,
  ratchetEncrypt,
  ratchetDecrypt,
  type RatchetState,
  type RatchetMessage,
} from "./doubleRatchet";
import { aesDecrypt, rawToAESKey } from "./primitives";
import {
  storeIdentityKey,
  getIdentityKey,
  storeSignedPrekey,
  getSignedPrekey,
  storeOneTimePrekeys,
  consumeOneTimePrekey,
  storeSession,
  getSession,
  storeMessageKey,
  getMessageKey,
  copyMessageKey,
  clearAllKeys,
} from "./keyStore";
import { b64urlToBytes, bytesToB64url } from "@/lib/base64";
import type { KeyBundle, EncryptedMessage } from "@/types/crypto";

// ── Setup ─────────────────────────────────────────────────────────────────────

/**
 * Generate all key material for a new user and upload public keys.
 * Call after successful WebAuthn registration.
 */
export async function setupIdentity(uploadFn: (bundle: object) => Promise<void>): Promise<void> {
  const identity = generateIdentity();
  const signedPrekey = generateSignedPrekey(1, identity.signingPrivateKey);
  const oneTimePrekeys = generateOneTimePrekeys(20, 0);

  // Store private keys locally (IndexedDB)
  await storeIdentityKey({
    dhPublicKey: identity.identityPublicKey,
    dhPrivateKey: identity.identityPrivateKey,
    signingPublicKey: identity.signingPublicKey,
    signingPrivateKey: identity.signingPrivateKey,
  });

  await storeSignedPrekey({
    keyId: signedPrekey.keyId,
    publicKey: signedPrekey.publicKey,
    privateKey: signedPrekey.privateKey,
    signature: signedPrekey.signature,
  });

  await storeOneTimePrekeys(
    oneTimePrekeys.map((k) => ({
      keyId: k.keyId,
      publicKey: k.publicKey,
      privateKey: k.privateKey,
    }))
  );

  // Upload ONLY public keys to server
  const bundle = buildKeyBundleUpload(identity, signedPrekey, oneTimePrekeys);
  await uploadFn(bundle);
}

// ── Session establishment ─────────────────────────────────────────────────────

export interface InitialMessagePayload {
  ephemeralPublicKey: string;
  identityPublicKey: string;
  usedSPKId: number;
  usedOPKId?: number;
  firstMessage: RatchetMessage;
}

/**
 * Alice initiates a session with Bob.
 * Returns the ratchet message + header info for Bob to re-derive the session.
 */
export async function initiateSession(
  roomId: string,
  plaintext: string,
  remoteBundle: KeyBundle,
  messageId?: string,
): Promise<{ encryptedPayload: InitialMessagePayload; ratchetStateJson: string }> {
  const identity = await getIdentityKey();
  if (!identity) throw new Error("No local identity key — run setupIdentity first");

  // X3DH
  const x3dhResult = await x3dhInitiate(identity.dhPrivateKey, remoteBundle);

  // Use remote's signed prekey public as initial ratchet key
  const remoteRatchetPub = b64urlToBytes(remoteBundle.signedPrekey.publicKey);
  const ratchetState = await ratchetInitAlice(x3dhResult.sharedSecret, remoteRatchetPub);

  // Encrypt first message
  const { message: firstMessage, newState, messageKey } = await ratchetEncrypt(ratchetState, plaintext);

  // Persist ratchet state
  const stateJson = serializeRatchetState(newState);
  await storeSession(roomId, stateJson);
  await storeMessageKey(roomId, messageId, messageKey);

  return {
    encryptedPayload: {
      ephemeralPublicKey: x3dhResult.ephemeralPublicKey,
      identityPublicKey: identity.dhPublicKey,
      usedSPKId: x3dhResult.usedSPKId,
      usedOPKId: x3dhResult.usedOPKId,
      firstMessage,
    },
    ratchetStateJson: stateJson,
  };
}

/**
 * Bob responds — re-derives the session from the initial message.
 */
export async function receiveSession(
  roomId: string,
  payload: InitialMessagePayload,
  messageId?: string,
): Promise<string> {
  const identity = await getIdentityKey();
  if (!identity) throw new Error("No local identity key");

  const spk = await getSignedPrekey(payload.usedSPKId);
  if (!spk) throw new Error(`Signed prekey ${payload.usedSPKId} not found`);

  let opkPrivKey: Uint8Array | undefined;
  if (payload.usedOPKId !== undefined) {
    const opk = await consumeOneTimePrekey(payload.usedOPKId);
    if (opk) opkPrivKey = opk.privateKey;
  }

  const sharedSecret = await x3dhRespond(
    identity.dhPrivateKey,
    spk.privateKey,
    opkPrivKey,
    payload.identityPublicKey,
    payload.ephemeralPublicKey
  );

  const ratchetState = await ratchetInitBob(
    sharedSecret,
    spk.privateKey,
    b64urlToBytes(spk.publicKey)
  );

  // Decrypt the first message
  const { plaintext, newState, messageKey } = await ratchetDecrypt(ratchetState, payload.firstMessage);

  await storeSession(roomId, serializeRatchetState(newState));
  await storeMessageKey(roomId, messageId, messageKey);
  return plaintext;
}

// ── Ongoing messaging ─────────────────────────────────────────────────────────

export async function encryptMessage(
  roomId: string,
  plaintext: string,
  messageId?: string,
): Promise<EncryptedMessage & { header: RatchetMessage["header"] }> {
  const stateJson = await getSession(roomId);
  if (!stateJson) throw new Error(`No session for room ${roomId}`);

  const state = deserializeRatchetState(stateJson);
  const { message, newState, messageKey } = await ratchetEncrypt(state, plaintext);
  await storeSession(roomId, serializeRatchetState(newState));
  await storeMessageKey(roomId, messageId, messageKey);

  return {
    ciphertext: message.ciphertext,
    nonce: message.nonce,
    algorithm: "AES-256-GCM",
    header: message.header,
    encryptedHeader: btoa(JSON.stringify(message.header)),
  };
}

export async function decryptMessage(
  roomId: string,
  msg: {
    id?: string;
    ciphertext: string;
    nonce: string;
    encryptedHeader?: string;
    encrypted_header?: string | null;
  }
): Promise<string> {
  const stateJson = await getSession(roomId);
  const encodedHeader = msg.encryptedHeader ?? msg.encrypted_header ?? undefined;
  if (!encodedHeader) throw new Error("Missing message header");
  const decodedHeader = JSON.parse(atob(encodedHeader)) as
    | RatchetMessage["header"]
    | {
        kind: "x3dh_initial";
        ephemeralPublicKey: string;
        identityPublicKey: string;
        usedSPKId: number;
        usedOPKId?: number;
        header: RatchetMessage["header"];
      };

  if (!stateJson) {
    if ("kind" in decodedHeader && decodedHeader.kind === "x3dh_initial") {
      return receiveSession(roomId, {
        ephemeralPublicKey: decodedHeader.ephemeralPublicKey,
        identityPublicKey: decodedHeader.identityPublicKey,
        usedSPKId: decodedHeader.usedSPKId,
        usedOPKId: decodedHeader.usedOPKId,
        firstMessage: {
          header: decodedHeader.header,
          ciphertext: msg.ciphertext,
          nonce: msg.nonce,
        },
      }, msg.id);
    }
    throw new Error(`No session for room ${roomId}`);
  }

  if ("kind" in decodedHeader) {
    const cached = await decryptWithCachedMessageKey(roomId, msg);
    if (cached !== null) return cached;
    throw new Error("Unable to decrypt historical initial message on this device");
  }
  const header = decodedHeader;

  const state = deserializeRatchetState(stateJson);
  try {
    const { plaintext, newState, messageKey } = await ratchetDecrypt(state, {
      header,
      ciphertext: msg.ciphertext,
      nonce: msg.nonce,
    });

    await storeSession(roomId, serializeRatchetState(newState));
    await storeMessageKey(roomId, msg.id, messageKey);
    return plaintext;
  } catch (error) {
    const cached = await decryptWithCachedMessageKey(roomId, msg);
    if (cached !== null) return cached;
    throw error;
  }
}

export async function encryptInitialDirectMessage(
  roomId: string,
  plaintext: string,
  remoteBundle: KeyBundle,
  messageId?: string,
): Promise<EncryptedMessage> {
  const { encryptedPayload } = await initiateSession(roomId, plaintext, remoteBundle, messageId);
  return {
    ciphertext: encryptedPayload.firstMessage.ciphertext,
    nonce: encryptedPayload.firstMessage.nonce,
    algorithm: "AES-256-GCM",
    encryptedHeader: btoa(JSON.stringify({
      kind: "x3dh_initial",
      ephemeralPublicKey: encryptedPayload.ephemeralPublicKey,
      identityPublicKey: encryptedPayload.identityPublicKey,
      usedSPKId: encryptedPayload.usedSPKId,
      usedOPKId: encryptedPayload.usedOPKId,
      header: encryptedPayload.firstMessage.header,
    })),
  };
}

export async function rememberMessageKeyAlias(
  roomId: string,
  fromMessageId: string | undefined,
  toMessageId: string | undefined,
): Promise<void> {
  await copyMessageKey(roomId, fromMessageId, toMessageId);
}

async function decryptWithCachedMessageKey(
  roomId: string,
  msg: { id?: string; ciphertext: string; nonce: string },
): Promise<string | null> {
  const cachedKey = await getMessageKey(roomId, msg.id);
  if (!cachedKey) return null;
  const key = await rawToAESKey(cachedKey);
  return aesDecrypt(key, msg.ciphertext, msg.nonce);
}

// ── Serialization ─────────────────────────────────────────────────────────────

function serializeRatchetState(state: RatchetState): string {
  const skipped: Array<{ k: string; v: string }> = [];
  state.MKSKIPPED.forEach((val, key) => {
    skipped.push({ k: key, v: bytesToB64url(val) });
  });

  return JSON.stringify({
    DHs: state.DHs
      ? {
          priv: bytesToB64url(state.DHs.privateKey),
          pub: bytesToB64url(state.DHs.publicKey),
        }
      : null,
    DHr: state.DHr ? bytesToB64url(state.DHr) : null,
    RK: bytesToB64url(state.RK),
    CKs: state.CKs ? bytesToB64url(state.CKs) : null,
    CKr: state.CKr ? bytesToB64url(state.CKr) : null,
    Ns: state.Ns,
    Nr: state.Nr,
    PN: state.PN,
    MKSKIPPED: skipped,
  });
}

function deserializeRatchetState(json: string): RatchetState {
  const d = JSON.parse(json);
  const MKSKIPPED = new Map<string, Uint8Array>();
  for (const { k, v } of d.MKSKIPPED) {
    MKSKIPPED.set(k, b64urlToBytes(v));
  }
  return {
    DHs: d.DHs
      ? { privateKey: b64urlToBytes(d.DHs.priv), publicKey: b64urlToBytes(d.DHs.pub) }
      : null,
    DHr: d.DHr ? b64urlToBytes(d.DHr) : null,
    RK: b64urlToBytes(d.RK),
    CKs: d.CKs ? b64urlToBytes(d.CKs) : null,
    CKr: d.CKr ? b64urlToBytes(d.CKr) : null,
    Ns: d.Ns,
    Nr: d.Nr,
    PN: d.PN,
    MKSKIPPED,
  };
}

export { clearAllKeys };
