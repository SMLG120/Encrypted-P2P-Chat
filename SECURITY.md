# Security Model & Threat Model

## ⚠️ Disclaimer

This is an **educational portfolio project**. The cryptographic design follows the Signal protocol specification, and core primitives use audited libraries (`@noble/curves`, `@noble/hashes`, WebCrypto). However, this implementation has **not been independently security-audited**. Do not rely on it for communications where your physical safety, legal protection, or privacy are at stake.

For production-grade secure messaging, use: **Signal**, **WhatsApp** (for E2EE), or **Wire**.

---

## What the Server Stores

| Data | Stored | Encrypted |
|------|--------|-----------|
| Username, display name | ✅ | ❌ (metadata) |
| WebAuthn public key credential | ✅ | N/A (public) |
| X25519 identity public key | ✅ | N/A (public) |
| Ed25519 signing public key | ✅ | N/A (public) |
| Signed prekeys (public + sig) | ✅ | N/A (public) |
| One-time prekeys (public) | ✅ | N/A (public) |
| Message ciphertext | ✅ | ✅ (AES-256-GCM) |
| Message nonce | ✅ | N/A (required for decryption) |
| Ratchet header (encrypted) | ✅ | ✅ |
| Room membership | ✅ | ❌ (metadata) |
| Message timestamps | ✅ | ❌ (metadata) |
| Private keys (any) | ❌ | — |
| Message plaintext | ❌ | — |

---

## Threat Model

### Attacker: Compromised Server
**Can learn:** Who has accounts; who talks to whom; when and how often; approximate message sizes; ciphertext (cannot decrypt without client private keys).

**Cannot learn:** Message content; private key material; session keys.

### Attacker: Network Observer (passive)
**Can learn:** That you are communicating with the Crypt server; connection timing.

**Cannot learn:** Message content (TLS + E2EE); who you are communicating with (server knows, but the observer sees only server IP).

### Attacker: Compromised Client Device
**Can learn:** Everything — including decrypted messages, private keys in IndexedDB, and active session state.

**Mitigation:** This is inherent to any messenger. Signal faces the same threat. Defense requires device security (full-disk encryption, strong PIN, trusted OS).

### Attacker: Future Key Compromise
**Forward secrecy:** Past messages cannot be decrypted if current keys are compromised, because each message uses a derived key that is not stored.

**Break-in recovery:** Future messages recover confidentiality after a compromise because the Double Ratchet advances with new DH material on each reply.

---

## Key Lifecycle

1. **Registration:** Client generates IK (X25519 + Ed25519), 1 SPK, 20 OPKs. Public keys uploaded. Private keys stored in IndexedDB.
2. **Session initiation:** Initiator fetches bundle, performs X3DH, OPK is atomically consumed (never reused). Shared secret seeded into Double Ratchet.
3. **Ongoing messaging:** Each message advances the symmetric ratchet (new AES key per message). Each reply performs a DH ratchet step.
4. **OPK replenishment:** Client monitors OPK count and uploads more when below threshold.
5. **SPK rotation:** Signed prekeys are rotated every 7 days. Old SPKs are deactivated.
6. **Logout:** `clearAllKeys()` wipes IndexedDB. Session cookie is deleted.

---

## Known Limitations

1. **No group forward secrecy:** Group rooms use individual pairwise encryption. A proper implementation would use Sender Keys (Signal's group protocol). This is marked as a TODO.
2. **No key backup:** Private keys in IndexedDB are lost if the browser data is cleared or the device is replaced. There is no key backup mechanism.
3. **Metadata leakage:** The server knows room membership and message timing — this is hard to avoid without a more sophisticated anonymity network (e.g., Tor + PIR).
4. **Not audited:** See disclaimer above.
5. **Single device:** Each user has one identity key. Multi-device key distribution (like Signal's sealed sender) is not implemented.

---

## Attachments and Object Storage

File attachments are encrypted client-side (random per-file key, never sent to the server) before upload, exactly like message content. The server only ever stores the encrypted blob plus non-sensitive routing metadata (room id, uploader id, filename, MIME type, size, sha256 of the *ciphertext*).

This holds regardless of which storage backend is configured:

- **Local disk** (`ATTACHMENT_STORAGE_BACKEND=local`, default): blobs live under `ATTACHMENT_STORAGE_DIR` on the backend host/container.
- **S3-compatible** (`ATTACHMENT_STORAGE_BACKEND=s3`): blobs live in the configured bucket (AWS S3, Cloudflare R2, Supabase Storage, or any S3-compatible endpoint). The bucket only ever receives ciphertext — enable default server-side encryption on the bucket as defense in depth, but it is not a substitute for the client-side encryption, which is what actually protects confidentiality from the storage provider itself.

Object keys are server-generated UUIDs, never derived from user-supplied filenames or paths, so there is no path-traversal surface on either backend. Downloads (`GET /api/v1/attachments/{id}/blob`) require the requester to be a member of the room the attachment belongs to — see `MessageService.get_attachment_for_user`.

---

## Responsible Disclosure

This is a portfolio/educational project, not a funded or monitored security program — there is no bug bounty. That said, if you find a real vulnerability:

1. Do not open a public GitHub issue with exploit details.
2. Email the maintainer (replace with a real contact before deploying this publicly: `security@REPLACE_WITH_YOUR_DOMAIN`) with a description and reproduction steps.
3. Allow a reasonable window to respond before any public disclosure.

Given the disclaimer above, treat any report as informational rather than expecting a coordinated CVE-style response.
