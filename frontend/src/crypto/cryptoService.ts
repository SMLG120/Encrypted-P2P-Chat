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
  verifySignedPrekey,
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
  getOneTimePrekey,
  deleteOneTimePrekey,
  getAllOneTimePrekeys,
  storeSession,
  getSession,
  storeMessageKey,
  getMessageKey,
  copyMessageKey,
  clearAllKeys,
} from "./keyStore";
import { b64urlToBytes, bytesToB64url } from "@/lib/base64";
import type { KeyBundle, EncryptedMessage } from "@/types/crypto";
import { keyService } from "@/services/keyService";

// ── Setup ─────────────────────────────────────────────────────────────────────

export type LocalIdentitySetupPhase = "checking" | "generating" | "uploading";
export type LocalIdentitySetupResult = "existing" | "created";

interface LocalIdentitySetupOptions {
  onStatus?: (status: LocalIdentitySetupPhase) => void;
}

/**
 * Generate all key material for a new user and upload public keys.
 * Call after successful WebAuthn registration.
 */
export async function setupIdentity(
  uploadFn: (bundle: object) => Promise<void>,
  options: LocalIdentitySetupOptions = {},
): Promise<void> {
  console.debug("generating local identity keys");
  options.onStatus?.("generating");

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
  console.debug("uploading public prekey bundle");
  options.onStatus?.("uploading");
  await uploadFn(bundle);
  console.debug("encryption setup ready");
}

export async function ensureLocalIdentity(
  uploadFn: (bundle: object) => Promise<void>,
  options: LocalIdentitySetupOptions = {},
): Promise<LocalIdentitySetupResult> {
  console.debug("checking local identity keys");
  options.onStatus?.("checking");

  const identity = await getIdentityKey();
  if (identity) {
    console.debug("local identity keys found");
    const existingBundle = await buildExistingKeyBundleUpload();
    if (existingBundle) {
      console.debug("uploading public prekey bundle");
      options.onStatus?.("uploading");
      await uploadFn(existingBundle);
    }
    await replenishOneTimePrekeysIfNeeded();
    console.debug("encryption setup ready");
    return "existing";
  }

  console.debug("local identity keys missing");
  await setupIdentity(uploadFn, options);
  return "created";
}

const OPK_REPLENISH_COUNT = 20;

/**
 * Generate and upload new one-time prekeys when the server pool is low.
 */
export async function replenishOneTimePrekeysIfNeeded(): Promise<void> {
  const status = await keyService.getStatus();
  if (!status.needs_replenishment) return;

  const existing = await getAllOneTimePrekeys();
  const maxKeyId = existing.reduce((max, prekey) => Math.max(max, prekey.keyId), -1);
  const startKeyId = maxKeyId + 1;
  const newPrekeys = generateOneTimePrekeys(OPK_REPLENISH_COUNT, startKeyId);

  await storeOneTimePrekeys(
    newPrekeys.map((prekey) => ({
      keyId: prekey.keyId,
      publicKey: prekey.publicKey,
      privateKey: prekey.privateKey,
    })),
  );

  await keyService.replenish(
    newPrekeys.map((prekey) => ({
      key_id: prekey.keyId,
      public_key: prekey.publicKey,
    })),
  );
  console.debug("replenished one-time prekeys", { count: newPrekeys.length });
}

async function buildExistingKeyBundleUpload(): Promise<object | null> {
  const identity = await getIdentityKey();
  const signedPrekey = await getSignedPrekey(1);
  if (!identity || !signedPrekey) return null;

  const oneTimePrekeys = await getAllOneTimePrekeys();
  return {
    identity: {
      identity_public_key: identity.dhPublicKey,
      signing_public_key: identity.signingPublicKey,
    },
    signed_prekey: {
      key_id: signedPrekey.keyId,
      public_key: signedPrekey.publicKey,
      signature: signedPrekey.signature,
    },
    one_time_prekeys: oneTimePrekeys.map((prekey) => ({
      key_id: prekey.keyId,
      public_key: prekey.publicKey,
    })),
  };
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
  peerId?: string,
): Promise<{ encryptedPayload: InitialMessagePayload; ratchetStateJson: string }> {
  const identity = await getIdentityKey();
  if (!identity) throw new Error("No local identity key — run setupIdentity first");
  if (!verifySignedPrekey(remoteBundle.signingPublicKey, remoteBundle.signedPrekey)) {
    throw new Error("Remote signed prekey verification failed");
  }

  // X3DH
  console.debug("initializing X3DH session");
  const x3dhResult = await x3dhInitiate(identity.dhPrivateKey, remoteBundle);

  // Use remote's signed prekey public as initial ratchet key
  const remoteRatchetPub = b64urlToBytes(remoteBundle.signedPrekey.publicKey);
  const ratchetState = await ratchetInitAlice(x3dhResult.sharedSecret, remoteRatchetPub);

  // Encrypt first message
  const { message: firstMessage, newState, messageKey } = await ratchetEncrypt(ratchetState, plaintext);

  // Persist ratchet state
  const stateJson = serializeRatchetState(newState);
  const sessionId = sessionStorageKey(roomId, peerId ?? remoteBundle.userId);
  console.debug("saving ratchet state for peer_id");
  await storeSession(sessionId, stateJson);
  await storeMessageKey(sessionId, messageId, messageKey);

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
  peerId?: string,
): Promise<string> {
  console.debug("checking local identity keys");
  const identity = await getIdentityKey();
  if (!identity) {
    console.debug("local identity keys missing");
    throw new Error("No local identity key");
  }
  console.debug("local identity keys found");

  const spk = await getSignedPrekey(payload.usedSPKId);
  if (!spk) throw new Error(`Signed prekey ${payload.usedSPKId} not found`);

  let opkPrivKey: Uint8Array | undefined;
  let opkKeyIdToDelete: number | undefined;
  if (payload.usedOPKId !== undefined) {
    const opk = await getOneTimePrekey(payload.usedOPKId);
    if (opk) {
      opkPrivKey = opk.privateKey;
      opkKeyIdToDelete = opk.keyId;
    }
  }

  console.debug("initializing X3DH session");
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

  if (opkKeyIdToDelete !== undefined) {
    await deleteOneTimePrekey(opkKeyIdToDelete);
  }

  const sessionId = sessionStorageKey(roomId, peerId);
  console.debug("saving ratchet state for peer_id");
  await storeSession(sessionId, serializeRatchetState(newState));
  await storeMessageKey(sessionId, messageId, messageKey);
  return plaintext;
}

// ── Ongoing messaging ─────────────────────────────────────────────────────────

export async function encryptMessage(
  roomId: string,
  plaintext: string,
  messageId?: string,
  peerId?: string,
): Promise<EncryptedMessage & { header: RatchetMessage["header"] }> {
  const sessionId = await resolveExistingSessionKey(roomId, peerId);
  console.debug("loading ratchet state for peer_id");
  const stateJson = await getSession(sessionId);
  if (!stateJson) throw new Error(`No session for room ${roomId}`);

  const state = deserializeRatchetState(stateJson);
  const { message, newState, messageKey } = await ratchetEncrypt(state, plaintext);
  console.debug("saving ratchet state for peer_id");
  await storeSession(sessionId, serializeRatchetState(newState));
  await storeMessageKey(sessionId, messageId, messageKey);

  // Encode header as base64url (not btoa) to match backend expectation
  const headerJson = JSON.stringify(message.header);
  const headerBytes = new TextEncoder().encode(headerJson);
  const encryptedHeaderB64url = bytesToB64url(headerBytes);
  console.debug("encrypting message with header fields");

  return {
    ciphertext: message.ciphertext,
    nonce: message.nonce,
    algorithm: "AES-256-GCM",
    header: message.header,
    encryptedHeader: encryptedHeaderB64url,
  };
}

export async function decryptMessage(
  roomId: string,
  msg: {
    id?: string;
    sender_id?: string;
    recipient_id?: string | null;
    ciphertext: string;
    nonce: string;
    encryptedHeader?: string;
    encrypted_header?: string | null;
  },
  peerId?: string,
): Promise<string> {
  const sessionId = await resolveExistingSessionKey(roomId, peerId);
  console.debug("loading ratchet state for peer_id");
  const stateJson = await getSession(sessionId);
  const encodedHeader = msg.encryptedHeader ?? msg.encrypted_header ?? undefined;
  if (!encodedHeader) throw new Error("Missing message header");
  
  // Decode base64url header (server sends snake_case)
  let decodedHeader:
    | RatchetMessage["header"]
    | {
        kind: "x3dh_initial";
        ephemeralPublicKey: string;
        identityPublicKey: string;
        usedSPKId: number;
        usedOPKId?: number;
        header: RatchetMessage["header"];
      };
  try {
    const headerBytes = b64urlToBytes(encodedHeader);
    decodedHeader = JSON.parse(new TextDecoder().decode(headerBytes));
  } catch (error) {
    console.debug("decryption failed at stage: header");
    throw error;
  }

  if (!stateJson) {
    if ("kind" in decodedHeader && decodedHeader.kind === "x3dh_initial") {
      console.debug("attempting decrypt with peer_id");
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
      }, msg.id, peerId);
    }
    console.debug("decryption failed at stage: session");
    throw new Error(`No session for room ${roomId}`);
  }

  if ("kind" in decodedHeader) {
    const cached = await decryptWithCachedMessageKey(sessionId, msg);
    if (cached !== null) return cached;
    console.debug("decryption failed at stage: session");
    throw new Error("Unable to decrypt historical initial message on this device");
  }
  const header = decodedHeader;

  const state = deserializeRatchetState(stateJson);
  try {
    console.debug("attempting decrypt with peer_id");
    const { plaintext, newState, messageKey } = await ratchetDecrypt(state, {
      header,
      ciphertext: msg.ciphertext,
      nonce: msg.nonce,
    });

    console.debug("saving ratchet state for peer_id");
    await storeSession(sessionId, serializeRatchetState(newState));
    await storeMessageKey(sessionId, msg.id, messageKey);
    return plaintext;
  } catch (error) {
    const cached = await decryptWithCachedMessageKey(sessionId, msg);
    if (cached !== null) return cached;
    console.debug("decryption failed at stage: aes-gcm");
    throw error;
  }
}

export async function encryptInitialDirectMessage(
  roomId: string,
  plaintext: string,
  remoteBundle: KeyBundle,
  messageId?: string,
  peerId?: string,
): Promise<EncryptedMessage> {
  const { encryptedPayload } = await initiateSession(
    roomId,
    plaintext,
    remoteBundle,
    messageId,
    peerId ?? remoteBundle.userId,
  );
  const headerJson = JSON.stringify({
    kind: "x3dh_initial",
    ephemeralPublicKey: encryptedPayload.ephemeralPublicKey,
    identityPublicKey: encryptedPayload.identityPublicKey,
    usedSPKId: encryptedPayload.usedSPKId,
    usedOPKId: encryptedPayload.usedOPKId,
    header: encryptedPayload.firstMessage.header,
  });
  const headerBytes = new TextEncoder().encode(headerJson);

  return {
    ciphertext: encryptedPayload.firstMessage.ciphertext,
    nonce: encryptedPayload.firstMessage.nonce,
    algorithm: "AES-256-GCM",
    encryptedHeader: bytesToB64url(headerBytes),
  };
}

export async function rememberMessageKeyAlias(
  roomId: string,
  fromMessageId: string | undefined,
  toMessageId: string | undefined,
  peerId?: string,
): Promise<void> {
  const sessionId = await resolveExistingSessionKey(roomId, peerId);
  await copyMessageKey(sessionId, fromMessageId, toMessageId);
}

export async function decryptGroupMessagePayloads<T extends {
  id?: string;
  room_id: string;
  sender_id?: string;
  recipient_id?: string | null;
  ciphertext: string;
  nonce: string;
  encrypted_header?: string | null;
}>(
  messages: T[],
  currentUserId: string,
): Promise<Array<T & { plaintext?: string; decryptionFailed?: boolean }>> {
  return Promise.all(
    messages.map(async (message) => {
      const peerId =
        message.sender_id === currentUserId
          ? message.recipient_id ?? currentUserId
          : message.sender_id;
      try {
        return {
          ...message,
          plaintext: await decryptMessage(message.room_id, message, peerId),
        };
      } catch {
        return { ...message, decryptionFailed: true };
      }
    }),
  );
}

async function decryptWithCachedMessageKey(
  sessionId: string,
  msg: { id?: string; ciphertext: string; nonce: string },
): Promise<string | null> {
  const cachedKey = await getMessageKey(sessionId, msg.id);
  if (!cachedKey) return null;
  const key = await rawToAESKey(cachedKey);
  return aesDecrypt(key, msg.ciphertext, msg.nonce);
}

function sessionStorageKey(roomId: string, peerId?: string): string {
  return peerId ? `${roomId}:${peerId}` : roomId;
}

async function resolveExistingSessionKey(roomId: string, peerId?: string): Promise<string> {
  const scoped = sessionStorageKey(roomId, peerId);
  if (scoped !== roomId && (await getSession(scoped))) return scoped;
  if (await getSession(roomId)) return roomId;
  return scoped;
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
