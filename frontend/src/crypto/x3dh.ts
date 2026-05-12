/**
 * X3DH — Extended Triple Diffie-Hellman (Signal Protocol §3)
 *
 * DISCLAIMER: This is an educational implementation following the X3DH spec.
 * It has NOT been independently audited. The core DH math uses @noble/curves
 * which is well-maintained; the KDF uses HKDF-SHA256.
 *
 * Initiator flow (Alice → Bob):
 *   1. Fetch Bob's key bundle (IKb, SPKb, OPKb) from server
 *   2. Generate ephemeral key pair (EK)
 *   3. DH1 = DH(IKa, SPKb)
 *   4. DH2 = DH(EKa, IKb)
 *   5. DH3 = DH(EKa, SPKb)
 *   6. DH4 = DH(EKa, OPKb)  [if OPK available]
 *   7. SK = HKDF(DH1 || DH2 || DH3 || DH4)
 *
 * Responder flow (Bob receives initial message):
 *   1. Look up EKa from message header
 *   2. DH1 = DH(SPKb, IKa)
 *   3. DH2 = DH(IKb, EKa)
 *   4. DH3 = DH(SPKb, EKa)
 *   5. DH4 = DH(OPKb, EKa)  [if OPK was used]
 *   6. SK = HKDF(DH1 || DH2 || DH3 || DH4)
 */

import { x25519DH, generateX25519KeyPair, hkdfDerive, rawToAESKey } from "./primitives";
import { b64urlToBytes, bytesToB64url } from "@/lib/base64";
import type { KeyBundle, X3DHResult } from "@/types/crypto";

const X3DH_INFO = "X3DH_v1_WhisperText_Curve25519_SHA-256_AES-256-GCM";
const X3DH_SALT = new Uint8Array(32); // all-zero salt per spec

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const arr of arrays) {
    out.set(arr, offset);
    offset += arr.length;
  }
  return out;
}

/**
 * Initiator: compute shared secret and return ephemeral public key.
 */
export async function x3dhInitiate(
  localIdentityPrivKey: Uint8Array,
  remoteBundle: KeyBundle
): Promise<X3DHResult> {
  // Generate ephemeral key pair
  const ephemeral = generateX25519KeyPair();

  const ikA = localIdentityPrivKey;
  const spkB = b64urlToBytes(remoteBundle.signedPrekey.publicKey);
  const ikB = b64urlToBytes(remoteBundle.identityPublicKey);
  const ekA = ephemeral.privateKey;

  // The four DH operations
  const dh1 = x25519DH(ikA, spkB);  // IKa, SPKb
  const dh2 = x25519DH(ekA, ikB);   // EKa, IKb
  const dh3 = x25519DH(ekA, spkB);  // EKa, SPKb

  let ikm: Uint8Array;
  if (remoteBundle.oneTimePrekey) {
    const opkB = b64urlToBytes(remoteBundle.oneTimePrekey.publicKey);
    const dh4 = x25519DH(ekA, opkB); // EKa, OPKb
    ikm = concat(dh1, dh2, dh3, dh4);
  } else {
    ikm = concat(dh1, dh2, dh3);
  }

  const skBytes = hkdfDerive(ikm, X3DH_SALT, X3DH_INFO, 32);
  const sharedSecret = await rawToAESKey(skBytes);

  return {
    sharedSecret,
    ephemeralPublicKey: bytesToB64url(ephemeral.publicKey),
    usedSPKId: remoteBundle.signedPrekey.keyId,
    usedOPKId: remoteBundle.oneTimePrekey?.keyId,
  };
}

/**
 * Responder: recompute shared secret from received initial message.
 */
export async function x3dhRespond(
  localIdentityPrivKey: Uint8Array,
  localSignedPrekeyPrivKey: Uint8Array,
  localOTPrekeyPrivKey: Uint8Array | undefined,
  remoteIdentityPublicKey: string,
  ephemeralPublicKey: string
): Promise<CryptoKey> {
  const spkB = localSignedPrekeyPrivKey;
  const ikB = localIdentityPrivKey;
  const ikA = b64urlToBytes(remoteIdentityPublicKey);
  const ekA = b64urlToBytes(ephemeralPublicKey);

  const dh1 = x25519DH(spkB, ikA);
  const dh2 = x25519DH(ikB, ekA);
  const dh3 = x25519DH(spkB, ekA);

  let ikm: Uint8Array;
  if (localOTPrekeyPrivKey) {
    const dh4 = x25519DH(localOTPrekeyPrivKey, ekA);
    ikm = concat(dh1, dh2, dh3, dh4);
  } else {
    ikm = concat(dh1, dh2, dh3);
  }

  const skBytes = hkdfDerive(ikm, X3DH_SALT, X3DH_INFO, 32);
  return rawToAESKey(skBytes);
}
