/**
 * Double Ratchet Algorithm (Signal Protocol §2)
 *
 * DISCLAIMER: Educational implementation. NOT independently audited.
 * Follows the spec at https://signal.org/docs/specifications/doubleratchet/
 *
 * The ratchet provides:
 *   - Forward secrecy: past message keys cannot be derived from current state
 *   - Break-in recovery: future messages recover after key compromise
 *   - Out-of-order message decryption (up to MAX_SKIP)
 */

import {
  generateX25519KeyPair,
  x25519DH,
  kdfRootKey,
  kdfChainKey,
  aesEncrypt,
  aesDecrypt,
  exportAESKeyRaw,
  rawToAESKey,
} from "./primitives";
import { b64urlToBytes, bytesToB64url } from "@/lib/base64";

const MAX_SKIP = 1000; // Maximum skipped message keys to store

export interface RatchetState {
  // DH ratchet
  DHs: { privateKey: Uint8Array; publicKey: Uint8Array } | null; // our sending ratchet key
  DHr: Uint8Array | null; // remote's ratchet public key
  // Chain keys (raw bytes for serialization)
  RK: Uint8Array;   // root key
  CKs: Uint8Array | null; // sending chain key
  CKr: Uint8Array | null; // receiving chain key
  // Message counters
  Ns: number;  // messages sent in current sending chain
  Nr: number;  // messages received in current receiving chain
  PN: number;  // messages in previous sending chain
  // Skipped message keys: "ratchet_pub_b64:msg_count" → message key bytes
  MKSKIPPED: Map<string, Uint8Array>;
}

export interface MessageHeader {
  dh: string;  // sender's current ratchet public key (base64url)
  pn: number;  // previous chain message count
  n: number;   // message number in current chain
}

export interface RatchetMessage {
  header: MessageHeader;
  ciphertext: string;
  nonce: string;
}

/** Initialize ratchet state for the initiator (Alice) after X3DH. */
export async function ratchetInitAlice(
  sharedSecret: CryptoKey,
  bobRatchetPublicKey: Uint8Array
): Promise<RatchetState> {
  const SK = await exportAESKeyRaw(sharedSecret);
  const DHs = generateX25519KeyPair();
  const dh = x25519DH(DHs.privateKey, bobRatchetPublicKey);
  const [RK, CKs] = kdfRootKey(SK, dh);

  return {
    DHs,
    DHr: bobRatchetPublicKey,
    RK,
    CKs,
    CKr: null,
    Ns: 0,
    Nr: 0,
    PN: 0,
    MKSKIPPED: new Map(),
  };
}

/** Initialize ratchet state for the responder (Bob) after X3DH. */
export async function ratchetInitBob(
  sharedSecret: CryptoKey,
  bobSignedPrekeyPrivate: Uint8Array,
  bobSignedPrekeyPublic: Uint8Array
): Promise<RatchetState> {
  const SK = await exportAESKeyRaw(sharedSecret);
  return {
    DHs: { privateKey: bobSignedPrekeyPrivate, publicKey: bobSignedPrekeyPublic },
    DHr: null,
    RK: SK,
    CKs: null,
    CKr: null,
    Ns: 0,
    Nr: 0,
    PN: 0,
    MKSKIPPED: new Map(),
  };
}

/** Encrypt a message and advance the sending chain. */
export async function ratchetEncrypt(
  state: RatchetState,
  plaintext: string
): Promise<{ message: RatchetMessage; newState: RatchetState; messageKey: Uint8Array }> {
  if (!state.CKs || !state.DHs) {
    throw new Error("Ratchet not initialized for sending");
  }

  const [newCKs, mk] = kdfChainKey(state.CKs);
  const msgKey = await rawToAESKey(mk);
  const header: MessageHeader = {
    dh: bytesToB64url(state.DHs.publicKey),
    pn: state.PN,
    n: state.Ns,
  };

  const { ciphertext, nonce } = await aesEncrypt(msgKey, plaintext);

  const newState: RatchetState = {
    ...state,
    CKs: newCKs,
    Ns: state.Ns + 1,
    MKSKIPPED: new Map(state.MKSKIPPED),
  };

  return {
    message: { header, ciphertext, nonce },
    newState,
    messageKey: mk,
  };
}

/** Decrypt a message and advance the receiving chain. */
export async function ratchetDecrypt(
  state: RatchetState,
  message: RatchetMessage
): Promise<{ plaintext: string; newState: RatchetState; messageKey: Uint8Array }> {
  const header = message.header;
  let newState = { ...state, MKSKIPPED: new Map(state.MKSKIPPED) };

  // Check skipped message keys first
  const skippedKey = `${header.dh}:${header.n}`;
  const skippedMK = newState.MKSKIPPED.get(skippedKey);
  if (skippedMK) {
    newState.MKSKIPPED.delete(skippedKey);
    const msgKey = await rawToAESKey(skippedMK);
    const plaintext = await aesDecrypt(msgKey, message.ciphertext, message.nonce);
    return { plaintext, newState, messageKey: skippedMK };
  }

  const remoteDH = b64urlToBytes(header.dh);

  // If new ratchet key — perform DH ratchet step
  if (!state.DHr || !arraysEqual(state.DHr, remoteDH)) {
    // Skip messages in previous chain
    newState = await skipMessageKeys(newState, header.pn);
    // DH ratchet step
    newState = await dhRatchetStep(newState, remoteDH);
  }

  // Skip messages in current chain
  newState = await skipMessageKeys(newState, header.n);

  if (!newState.CKr) {
    throw new Error("No receiving chain key");
  }

  const [newCKr, mk] = kdfChainKey(newState.CKr);
  newState = { ...newState, CKr: newCKr, Nr: newState.Nr + 1 };

  const msgKey = await rawToAESKey(mk);
  const plaintext = await aesDecrypt(msgKey, message.ciphertext, message.nonce);

  return { plaintext, newState, messageKey: mk };
}

async function skipMessageKeys(
  state: RatchetState,
  until: number
): Promise<RatchetState> {
  if (!state.CKr) return state;
  if (state.Nr > until) return state;
  if (until - state.Nr > MAX_SKIP) {
    throw new Error("Too many skipped messages");
  }

  let newState = { ...state, MKSKIPPED: new Map(state.MKSKIPPED) };
  let CKr = state.CKr;

  while (newState.Nr < until) {
    const [newCKr, mk] = kdfChainKey(CKr);
    const key = `${state.DHr ? bytesToB64url(state.DHr) : "null"}:${newState.Nr}`;
    newState.MKSKIPPED.set(key, mk);
    CKr = newCKr;
    newState = { ...newState, CKr, Nr: newState.Nr + 1 };
  }

  return newState;
}

async function dhRatchetStep(
  state: RatchetState,
  remoteDH: Uint8Array
): Promise<RatchetState> {
  const PN = state.Ns;
  const newDHs = generateX25519KeyPair();

  // Receiving chain
  const dh1 = x25519DH(state.DHs!.privateKey, remoteDH);
  const [RK1, CKr] = kdfRootKey(state.RK, dh1);

  // Sending chain
  const dh2 = x25519DH(newDHs.privateKey, remoteDH);
  const [RK2, CKs] = kdfRootKey(RK1, dh2);

  return {
    ...state,
    DHs: newDHs,
    DHr: remoteDH,
    RK: RK2,
    CKs,
    CKr,
    Ns: 0,
    Nr: 0,
    PN,
  };
}

function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
