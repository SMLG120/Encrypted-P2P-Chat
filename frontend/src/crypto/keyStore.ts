/**
 * IndexedDB key store.
 *
 * SECURITY: All private keys are stored EXCLUSIVELY in IndexedDB.
 * They are NEVER:
 *   - Sent to the server
 *   - Stored in localStorage or sessionStorage
 *   - Logged or included in error messages
 *
 * Uses the 'idb' library for a typed Promise-based IndexedDB wrapper.
 */

import { openDB, type DBSchema, type IDBPDatabase } from "idb";

const DB_NAME = "crypt_keys_v1";
const DB_VERSION = 2;

interface KeyStoreSchema extends DBSchema {
  identity: {
    key: "identity";
    value: {
      dhPublicKey: string;
      dhPrivateKey: Uint8Array;
      signingPublicKey: string;
      signingPrivateKey: Uint8Array;
    };
  };
  signed_prekeys: {
    key: number;
    value: {
      keyId: number;
      publicKey: string;
      privateKey: Uint8Array;
      signature: string;
    };
  };
  one_time_prekeys: {
    key: number;
    value: {
      keyId: number;
      publicKey: string;
      privateKey: Uint8Array;
    };
  };
  sessions: {
    key: string; // roomId
    value: {
      roomId: string;
      ratchetStateJson: string;
      updatedAt: number;
    };
  };
  message_keys: {
    key: string;
    value: {
      id: string;
      roomId: string;
      messageId: string;
      key: Uint8Array;
      updatedAt: number;
    };
  };
}

let _db: IDBPDatabase<KeyStoreSchema> | null = null;

async function getDB(): Promise<IDBPDatabase<KeyStoreSchema>> {
  if (_db) return _db;
  _db = await openDB<KeyStoreSchema>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains("identity")) {
        db.createObjectStore("identity");
      }
      if (!db.objectStoreNames.contains("signed_prekeys")) {
        db.createObjectStore("signed_prekeys", { keyPath: "keyId" });
      }
      if (!db.objectStoreNames.contains("one_time_prekeys")) {
        db.createObjectStore("one_time_prekeys", { keyPath: "keyId" });
      }
      if (!db.objectStoreNames.contains("sessions")) {
        db.createObjectStore("sessions", { keyPath: "roomId" });
      }
      if (!db.objectStoreNames.contains("message_keys")) {
        db.createObjectStore("message_keys", { keyPath: "id" });
      }
    },
  });
  return _db;
}

// ── Identity Key ──────────────────────────────────────────────────────────────

export async function storeIdentityKey(key: {
  dhPublicKey: string;
  dhPrivateKey: Uint8Array;
  signingPublicKey: string;
  signingPrivateKey: Uint8Array;
}): Promise<void> {
  const db = await getDB();
  await db.put("identity", key, "identity");
}

export async function getIdentityKey(): Promise<{
  dhPublicKey: string;
  dhPrivateKey: Uint8Array;
  signingPublicKey: string;
  signingPrivateKey: Uint8Array;
} | null> {
  const db = await getDB();
  return (await db.get("identity", "identity")) ?? null;
}

// ── Signed Prekeys ────────────────────────────────────────────────────────────

export async function storeSignedPrekey(prekey: {
  keyId: number;
  publicKey: string;
  privateKey: Uint8Array;
  signature: string;
}): Promise<void> {
  const db = await getDB();
  await db.put("signed_prekeys", prekey);
}

export async function getSignedPrekey(keyId: number): Promise<{
  keyId: number;
  publicKey: string;
  privateKey: Uint8Array;
  signature: string;
} | null> {
  const db = await getDB();
  return (await db.get("signed_prekeys", keyId)) ?? null;
}

// ── One-time Prekeys ──────────────────────────────────────────────────────────

export async function storeOneTimePrekeys(
  prekeys: Array<{ keyId: number; publicKey: string; privateKey: Uint8Array }>
): Promise<void> {
  const db = await getDB();
  const tx = db.transaction("one_time_prekeys", "readwrite");
  for (const pk of prekeys) {
    await tx.store.put(pk);
  }
  await tx.done;
}

export async function consumeOneTimePrekey(keyId: number): Promise<{
  keyId: number;
  publicKey: string;
  privateKey: Uint8Array;
} | null> {
  const db = await getDB();
  const tx = db.transaction("one_time_prekeys", "readwrite");
  const pk = await tx.store.get(keyId);
  if (pk) {
    await tx.store.delete(keyId);
  }
  await tx.done;
  return pk ?? null;
}

export async function countOneTimePrekeys(): Promise<number> {
  const db = await getDB();
  return db.count("one_time_prekeys");
}

// ── Ratchet Sessions ──────────────────────────────────────────────────────────

export async function storeSession(roomId: string, ratchetStateJson: string): Promise<void> {
  const db = await getDB();
  await db.put("sessions", { roomId, ratchetStateJson, updatedAt: Date.now() });
}

export async function getSession(roomId: string): Promise<string | null> {
  const db = await getDB();
  const row = await db.get("sessions", roomId);
  return row?.ratchetStateJson ?? null;
}

export async function deleteSession(roomId: string): Promise<void> {
  const db = await getDB();
  await db.delete("sessions", roomId);
}

// ── Per-message keys ─────────────────────────────────────────────────────────

function messageKeyId(roomId: string, messageId: string): string {
  return `${roomId}:${messageId}`;
}

export async function storeMessageKey(
  roomId: string,
  messageId: string | undefined,
  key: Uint8Array,
): Promise<void> {
  if (!messageId) return;
  const db = await getDB();
  await db.put("message_keys", {
    id: messageKeyId(roomId, messageId),
    roomId,
    messageId,
    key,
    updatedAt: Date.now(),
  });
}

export async function getMessageKey(
  roomId: string,
  messageId: string | undefined,
): Promise<Uint8Array | null> {
  if (!messageId) return null;
  const db = await getDB();
  const row = await db.get("message_keys", messageKeyId(roomId, messageId));
  return row?.key ?? null;
}

export async function copyMessageKey(
  roomId: string,
  fromMessageId: string | undefined,
  toMessageId: string | undefined,
): Promise<void> {
  if (!fromMessageId || !toMessageId || fromMessageId === toMessageId) return;
  const key = await getMessageKey(roomId, fromMessageId);
  if (key) await storeMessageKey(roomId, toMessageId, key);
}

// ── Clear all (logout) ────────────────────────────────────────────────────────

export async function clearAllKeys(): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(
    ["identity", "signed_prekeys", "one_time_prekeys", "sessions", "message_keys"],
    "readwrite",
  );
  await Promise.all([
    tx.objectStore("identity").clear(),
    tx.objectStore("signed_prekeys").clear(),
    tx.objectStore("one_time_prekeys").clear(),
    tx.objectStore("sessions").clear(),
    tx.objectStore("message_keys").clear(),
  ]);
  await tx.done;
}
