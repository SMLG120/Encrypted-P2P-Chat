import { describe, expect, it } from "vitest";

import { bytesToB64url, b64urlToBytes } from "@/lib/base64";
import { generateIdentity, generateOneTimePrekeys, generateSignedPrekey } from "./identity";
import { ratchetDecrypt, ratchetEncrypt, ratchetInitAlice, ratchetInitBob } from "./doubleRatchet";
import {
  exportAESKeyRaw,
  generateX25519KeyPair,
  rawToAESKey,
} from "./primitives";
import { x3dhInitiate, x3dhRespond } from "./x3dh";
import type { KeyBundle } from "@/types/crypto";

function flipB64urlChar(value: string): string {
  const replacement = value.endsWith("A") ? "B" : "A";
  return `${value.slice(0, -1)}${replacement}`;
}

function keyBundleForBob(): {
  bundle: KeyBundle;
  identity: ReturnType<typeof generateIdentity>;
  signedPrekey: ReturnType<typeof generateSignedPrekey>;
  oneTimePrekey: ReturnType<typeof generateOneTimePrekeys>[number];
} {
  const identity = generateIdentity();
  const signedPrekey = generateSignedPrekey(1, identity.signingPrivateKey);
  const [oneTimePrekey] = generateOneTimePrekeys(1, 10);
  return {
    identity,
    signedPrekey,
    oneTimePrekey,
    bundle: {
      userId: "bob",
      identityPublicKey: identity.identityPublicKey,
      signingPublicKey: identity.signingPublicKey,
      signedPrekey: {
        keyId: signedPrekey.keyId,
        publicKey: signedPrekey.publicKey,
        signature: signedPrekey.signature,
      },
      oneTimePrekey: {
        keyId: oneTimePrekey.keyId,
        publicKey: oneTimePrekey.publicKey,
      },
    },
  };
}

describe("crypto pipeline", () => {
  it("derives the same X3DH shared key for sender and receiver", async () => {
    const alice = generateIdentity();
    const bob = keyBundleForBob();

    const initiated = await x3dhInitiate(alice.identityPrivateKey, bob.bundle);
    const responded = await x3dhRespond(
      bob.identity.identityPrivateKey,
      bob.signedPrekey.privateKey,
      bob.oneTimePrekey.privateKey,
      alice.identityPublicKey,
      initiated.ephemeralPublicKey,
    );

    expect(bytesToB64url(await exportAESKeyRaw(initiated.sharedSecret))).toBe(
      bytesToB64url(await exportAESKeyRaw(responded)),
    );
  });

  it("round-trips a Double Ratchet message", async () => {
    const sharedSecret = await rawToAESKey(crypto.getRandomValues(new Uint8Array(32)));
    const bobRatchet = generateX25519KeyPair();
    const aliceState = await ratchetInitAlice(sharedSecret, bobRatchet.publicKey);
    const bobState = await ratchetInitBob(
      sharedSecret,
      bobRatchet.privateKey,
      bobRatchet.publicKey,
    );

    const encrypted = await ratchetEncrypt(aliceState, "hello bob");
    const decrypted = await ratchetDecrypt(bobState, encrypted.message);

    expect(decrypted.plaintext).toBe("hello bob");
  });

  it("decrypts the first X3DH-backed message from the sender", async () => {
    const alice = generateIdentity();
    const bob = keyBundleForBob();

    const initiated = await x3dhInitiate(alice.identityPrivateKey, bob.bundle);
    const bobSharedSecret = await x3dhRespond(
      bob.identity.identityPrivateKey,
      bob.signedPrekey.privateKey,
      bob.oneTimePrekey.privateKey,
      alice.identityPublicKey,
      initiated.ephemeralPublicKey,
    );

    const aliceState = await ratchetInitAlice(
      initiated.sharedSecret,
      b64urlToBytes(bob.bundle.signedPrekey.publicKey),
    );
    const bobState = await ratchetInitBob(
      bobSharedSecret,
      bob.signedPrekey.privateKey,
      b64urlToBytes(bob.signedPrekey.publicKey),
    );

    const encrypted = await ratchetEncrypt(aliceState, "first message");
    const decrypted = await ratchetDecrypt(bobState, encrypted.message);

    expect(decrypted.plaintext).toBe("first message");
  });

  it("fails safely when ciphertext is tampered", async () => {
    const sharedSecret = await rawToAESKey(crypto.getRandomValues(new Uint8Array(32)));
    const bobRatchet = generateX25519KeyPair();
    const aliceState = await ratchetInitAlice(sharedSecret, bobRatchet.publicKey);
    const bobState = await ratchetInitBob(
      sharedSecret,
      bobRatchet.privateKey,
      bobRatchet.publicKey,
    );
    const encrypted = await ratchetEncrypt(aliceState, "do not change me");

    await expect(
      ratchetDecrypt(bobState, {
        ...encrypted.message,
        ciphertext: flipB64urlChar(encrypted.message.ciphertext),
      }),
    ).rejects.toBeTruthy();
  });

  it("round-trips ratchet header and nonce encoding", () => {
    const header = { dh: bytesToB64url(new Uint8Array([1, 2, 3])), pn: 4, n: 5 };
    const encodedHeader = bytesToB64url(new TextEncoder().encode(JSON.stringify(header)));
    const decodedHeader = JSON.parse(new TextDecoder().decode(b64urlToBytes(encodedHeader)));
    const nonce = crypto.getRandomValues(new Uint8Array(12));

    expect(decodedHeader).toEqual(header);
    expect(bytesToB64url(b64urlToBytes(bytesToB64url(nonce)))).toBe(bytesToB64url(nonce));
  });
});
