# Encrypted P2P Chat

Encrypted P2P Chat is a full-stack end-to-end encrypted messenger built with a FastAPI backend, WebAuthn/passkeys, WebSocket delivery, a TypeScript React frontend, client-side X3DH, Double Ratchet, WebCrypto, IndexedDB key storage, and ciphertext-only backend persistence.

This is an educational/portfolio implementation. The design follows Signal-style concepts, but it has not been independently audited. Do not use it for communications where safety depends on audited cryptography.

## Tech Stack

- Frontend: TypeScript, React, Vite, Tailwind CSS, Zustand, WebCrypto, IndexedDB, `@noble/curves`
- Backend: Python 3.12, FastAPI, SQLAlchemy async, Alembic, py_webauthn, Redis, PostgreSQL
- Realtime: WebSocket relay for encrypted messages, typing, presence, delivery/read receipts
- Crypto: X25519 identity keys, Ed25519 signed prekeys, X3DH, Double Ratchet, AES-256-GCM

## Security Model

The backend may store and relay:

- `ciphertext`
- `nonce`
- `encrypted_header`
- `sender_id`
- `recipient_id`
- `room_id`
- delivery metadata and timestamps
- public X3DH key material

The backend must never receive:

- plaintext message content
- private keys
- ratchet state
- root keys, chain keys, or message keys
- WebAuthn raw secrets or cookies in logs

Private encryption keys live only in the browser IndexedDB key store. Decryption happens only in the browser.

## Local Development Setup

Install dependencies:

```bash
brew install python@3.12
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip setuptools wheel
pip install -r backend/requirements.txt

cd frontend
npm ci
cd ..
```

Start dependencies:

```bash
docker compose -f docker-compose.dev.yml up -d postgres redis
```

Start the backend:

```bash
cd backend
../.venv/bin/python -m uvicorn app.main:app --reload --port 8000
```

Start the frontend:

```bash
cd frontend
npm run dev
```

Open the app at `http://localhost:5173`.

## Environment Variables

Backend local dev:

```env
API_BACKEND_URL=http://localhost:8000
RP_ID=localhost
RP_ORIGIN=http://localhost:5173
CORS_ALLOWED_ORIGINS=http://localhost:5173,http://localhost
SESSION_COOKIE_SECURE=false
SESSION_COOKIE_SAMESITE=lax
```

Frontend local dev:

```env
VITE_API_URL=http://localhost:8000
VITE_WS_URL=ws://localhost:8000/ws
VITE_FRONTEND_ORIGIN=http://localhost:5173
VITE_DEV_PROXY_TARGET=http://localhost:8000
```

Legacy backend variable names are still accepted for compatibility:

- `WEBAUTHN_RP_ID`
- `WEBAUTHN_ORIGIN`
- `ALLOWED_ORIGINS`
- `COOKIE_SECURE`
- `COOKIE_SAMESITE`

## localhost vs localhost:5173

`localhost` is the relying party ID for passkeys. It is a host name only and must not include a scheme or port.

`http://localhost:5173` is the frontend browser origin. WebAuthn origin checks require the scheme and port.

`http://localhost:8000` is the FastAPI backend URL when running locally without nginx.

Common local setup:

- Frontend: `http://localhost:5173`
- Backend API: `http://localhost:8000/api/v1`
- Backend WebSocket: `ws://localhost:8000/ws`
- RP ID: `localhost`
- RP origin: `http://localhost:5173`

Do not mix `localhost` and `127.0.0.1` during passkey testing. Browsers treat them as different WebAuthn relying parties.

## Passkey/WebAuthn Setup

For Vite local dev, use:

```env
RP_ID=localhost
RP_ORIGIN=http://localhost:5173
CORS_ALLOWED_ORIGINS=http://localhost:5173,http://localhost
SESSION_COOKIE_SECURE=false
SESSION_COOKIE_SAMESITE=lax
```

Common errors:

- `RP_ID=localhost:5173`: invalid, because RP ID cannot include a port.
- `RP_ORIGIN=localhost`: invalid, because origin must include scheme.
- Secure cookie on plain HTTP: the browser will not send the session cookie.
- CORS origin mismatch: requests may succeed without cookies or fail preflight.

To debug cookies and CORS:

1. In DevTools, check Application > Cookies for `localhost`.
2. Confirm the `session` cookie is set after login/register.
3. Confirm HTTP requests include credentials.
4. Confirm WebSocket frames connect to `ws://localhost:8000/ws`.
5. Confirm backend CORS includes the exact frontend origin.

## Encryption/Decryption Pipeline

Sender:

1. User types plaintext.
2. Browser checks local identity keys in IndexedDB.
3. If no ratchet session exists for the room and peer, browser fetches the peer prekey bundle.
4. Browser verifies the signed prekey.
5. Browser runs X3DH.
6. Browser initializes Double Ratchet sender state.
7. Browser encrypts plaintext locally.
8. Browser sends only ciphertext, nonce, encrypted header, recipient, room, and metadata.

Backend:

1. Authenticates the WebSocket or HTTP request via session cookie.
2. Validates room membership.
3. Stores ciphertext only.
4. Relays encrypted payloads unchanged to the intended recipient.
5. Never decrypts message content.

Recipient:

1. Browser receives an encrypted message event.
2. Browser derives the correct peer id from `sender_id` or `recipient_id`.
3. Browser loads local identity, signed prekey, one-time prekey, and ratchet state from IndexedDB.
4. If no session exists, browser uses the X3DH initial header to initialize receiver state.
5. Browser decrypts with Double Ratchet.
6. Browser saves updated ratchet state.
7. Browser displays plaintext locally.

## Message Delivery Pipeline

Direct messages use one encrypted payload addressed to the other member. The sender also receives its own WebSocket echo so the optimistic temporary message can be replaced with the stored message id.

Group messages use MVP pairwise encryption. One ciphertext row is stored per recipient. The backend routes each row only to that row's `recipient_id`, and group message history returns only the current user's recipient rows.

## Common Decryption Failure Causes

- Browser IndexedDB has no local identity private key.
- Local signed prekey or one-time prekey private key is missing.
- Server has stale one-time prekeys from an older browser-local key reset.
- Sender initial message is missing the X3DH header.
- Sender and recipient use different session keys for the same room/peer pair.
- Header JSON is encoded twice or decoded as the wrong base64 variant.
- Nonce or ciphertext uses base64 instead of base64url.
- Ratchet state is stored under `room_id` on one side and peer id on the other.
- Backend broadcasts a group recipient payload to the wrong member.
- Recipient receives a message before local key setup completes.
- Local WebAuthn/session cookie is not sent to the backend or WebSocket.

Safe debug logs are intentionally limited to stages such as key presence, prekey fetch, X3DH initialization, ratchet state load/save, and decrypt failure stage. They must not include plaintext, private keys, chain keys, message keys, root keys, raw credentials, cookies, or full ciphertext.

## Group Chat Design

MVP group chat uses pairwise encryption per recipient:

1. Alice writes one plaintext group message.
2. The browser encrypts that plaintext separately for Alice, Bob, Carol, and every other member.
3. The backend stores one ciphertext row per recipient.
4. The backend validates membership for create, add, leave, read, and send.
5. Each recipient only receives the row addressed to them.

This is simple and preserves the ciphertext-only backend rule. It is less efficient than Sender Keys because a group with `N` members stores `N` encrypted payloads per message.

Future roadmap: add Sender Keys for efficient group encryption after the MVP is stable.

## How to Test with Two Clients

1. Start PostgreSQL and Redis.
2. Start FastAPI on `http://localhost:8000`.
3. Start Vite on `http://localhost:5173`.
4. Open Alice in a normal browser window.
5. Open Bob in incognito or a second browser profile.
6. Register or log in both users.
7. Confirm both browsers complete local encryption key setup.
8. Alice creates a direct chat with Bob.
9. Alice sends a direct message.
10. Bob should see decrypted plaintext.
11. Bob replies.
12. Alice should see decrypted plaintext.
13. Refresh both pages.
14. Confirm message history decrypts again.
15. Create a group with Alice, Bob, and a third user.
16. Send a group message.
17. Confirm every member sees decrypted plaintext.
18. Confirm a non-member cannot fetch the group or group messages.

## How to Inspect WebSocket Frames

1. Open DevTools > Network.
2. Filter by `WS`.
3. Select `/ws`.
4. Inspect Frames.
5. Valid encrypted message frames contain ciphertext fields only.
6. There should be no `text`, `content`, `plaintext`, `privateKey`, `ratchetState`, `chainKey`, or `messageKey` fields.

## How to Verify Ciphertext-Only Storage

Run backend tests:

```bash
.venv/bin/pytest backend/app/tests
```

Manual database check:

```sql
select id, room_id, sender_id, recipient_id, ciphertext, encrypted_header, nonce
from messages
order by created_at desc
limit 10;
```

The `messages` table should contain encoded ciphertext and metadata only.

## Running Tests

Backend:

```bash
.venv/bin/pytest backend/app/tests
```

Frontend:

```bash
cd frontend
npm test -- --run
npm run build
```

## Troubleshooting Guide

`Decryption failed` on the first message:

- Confirm recipient IndexedDB has identity, signed prekey, and one-time prekeys.
- Confirm sender's encrypted header has `kind: "x3dh_initial"`.
- Confirm backend `/keys/upload` was called after the current browser generated keys.
- Clear stale local data only if you are willing to lose local private keys and undecryptable history.

Passkey fails locally:

- Use `RP_ID=localhost`.
- Use `RP_ORIGIN=http://localhost:5173`.
- Use the same host in the browser, backend env, and frontend env.
- Use `SESSION_COOKIE_SECURE=false` on plain HTTP.

WebSocket connects but messages do not arrive:

- Confirm the WebSocket URL is `ws://localhost:8000/ws`.
- Confirm the `session` cookie exists for `localhost`.
- Confirm the user is a member of the room.
- Confirm group rows have the intended `recipient_id`.

Messages decrypt before refresh but not after refresh:

- Confirm ratchet state is saved under the room plus peer session key.
- Confirm message key aliases are saved when temporary client ids are replaced by backend ids.
- Confirm logout did not clear IndexedDB keys.

## Known Limitations

- Crypto implementation is educational and unaudited.
- Multi-device encrypted sync is not implemented.
- Group chat uses pairwise per-recipient encryption, so large groups are inefficient.
- If a browser loses IndexedDB private keys, old messages may be undecryptable.
- Attachments are encrypted client-side but use the same local-key availability constraints as messages.

## Future Roadmap

- Sender Keys protocol for efficient group encryption
- Multi-device key sync and device lists
- Encrypted file sharing improvements
- Signed prekey rotation UI and OPK replenishment UX
- Stronger audit logging around ciphertext-only invariants
