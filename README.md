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

`docker-compose.dev.yml` intentionally maps these to **non-default host ports** — Postgres on `5433`, Redis on `6380` — so they don't clash with a Postgres/Redis you might already have running locally on the standard ports. Because of that, a natively-run backend (next step) needs an env file pointing at those ports; the framework's built-in defaults (`localhost:5432`, `localhost:6379`) will silently connect to the wrong thing — or nothing — otherwise, and every endpoint that touches the DB or session store will fail (`/health/ready` will show `degraded` if this happens).

```bash
cp backend/.env.example backend/.env
```

Start the backend:

```bash
cd backend
../.venv/bin/python -m uvicorn app.main:app --reload --port 8000
```

Verify it's actually healthy before touching the frontend — `--reload` does not re-read `.env` on file changes, so after editing `backend/.env` you must restart the process, not just save the file:

```bash
curl http://localhost:8000/health/ready
# {"status":"ready","checks":{"postgres":"ok","redis":"ok"}}
```

Start the frontend:

```bash
cd frontend
npm run dev
```

Open the app at `http://localhost:5173`.

## Docker Quick Start (Full Stack)

Run the entire stack (PostgreSQL, Redis, backend, frontend, nginx) on port 80:

```bash
export SECRET_KEY=$(python -c "import secrets; print(secrets.token_urlsafe(64))")
docker compose up --build -d
```

Open the app at `http://localhost` (not `:8000` or `:5173`).

Notes for Docker:

- `SECRET_KEY` is required — generate a random value as shown above.
- WebAuthn origin for Docker is `http://localhost` (port 80). The default compose config also allows `http://localhost:5173` for mixed dev testing.
- API and WebSocket use same-origin routing through nginx (`/api/v1`, `/ws`).

Check health:

```bash
curl -sf http://localhost/health/ready
docker compose ps
```

## Production Deployment

Two supported deployment paths — pick one, both are first-class:

```mermaid
flowchart LR
    subgraph "Path A: Managed services"
        V[Vercel<br/>frontend static build] -->|HTTPS, cross-origin| R[Render<br/>FastAPI backend]
        R --> SB[(Supabase<br/>PostgreSQL)]
        R --> RD[(Managed Redis<br/>e.g. Upstash/Render)]
        R --> S3[(R2 / S3<br/>encrypted attachments)]
    end
    subgraph "Path B: Single-host Docker Compose"
        N[nginx :80/:443] --> FE[frontend container]
        N --> BE[backend container]
        BE --> PG[(postgres container)]
        BE --> RDS[(redis container)]
        BE --> VOL[(named volume<br/>attachments)]
    end
```

### Path A — Vercel + Render + Supabase + R2/S3 (recommended for "real users, low ops")

1. **Database — Supabase (PostgreSQL):** create a project, copy the connection string, and rewrite it for asyncpg:
   `postgresql+asyncpg://USER:PASSWORD@HOST:5432/postgres`. Set this as `DATABASE_URL` on the backend service. Supabase connection pooling (port 6543) works too if you prefer it.
2. **Redis — any managed Redis** (Upstash, Render's own Redis, etc). Set `REDIS_URL` to the provided connection string (use the `rediss://` scheme if the provider requires TLS).
3. **Object storage — Cloudflare R2 (or AWS S3 / Supabase Storage):**
   - Create a bucket.
   - Create an access key with read/write scoped to that bucket only.
   - Set on the backend: `ATTACHMENT_STORAGE_BACKEND=s3`, `S3_BUCKET`, `S3_REGION` (R2: `auto`), `S3_ENDPOINT_URL` (R2: `https://<account-id>.r2.cloudflarestorage.com`; omit for AWS S3), `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.
   - See [Security Model](SECURITY.md#attachments-and-object-storage) — the bucket only ever stores client-side-encrypted ciphertext.
4. **Backend — Render:**
   - New Web Service from this repo, root directory `backend`, Dockerfile build (uses `backend/Dockerfile` as-is — no changes needed).
   - Add a **pre-deploy / one-off job** (Render "Job" or a deploy hook) running `python -m alembic upgrade head` before each release — see [Database Migrations](#database-migrations).
   - Environment variables (Render dashboard → Environment): `ENVIRONMENT=production`, `DEBUG=false`, `SECRET_KEY` (generate per the command below), `DATABASE_URL`, `REDIS_URL`, `RP_ID=<your frontend domain, no scheme/port>`, `RP_ORIGIN=https://<your frontend domain>`, `CORS_ALLOWED_ORIGINS=https://<your frontend domain>`, `SESSION_COOKIE_SECURE=true`, `SESSION_COOKIE_SAMESITE=lax` (or `none` only if you truly need cross-site cookies, which requires `Secure`), plus the S3 vars from step 3.
   - Render terminates TLS for you, so the app sees plain HTTP behind their proxy — that's expected and matches the `COOKIE_SECURE` flag, not raw transport.
5. **Frontend — Vercel:**
   - Import the repo, root directory `frontend`, framework preset "Vite".
   - Project env vars (Vercel dashboard → Settings → Environment Variables, *not* committed to git): `VITE_API_URL=https://<your-render-backend-domain>`, `VITE_WS_URL=wss://<your-render-backend-domain>/ws`, `VITE_FRONTEND_ORIGIN=https://<your-vercel-domain>`. These override the placeholders in `frontend/.env.production`.
6. **WebAuthn correctness:** `RP_ID` must be the bare frontend hostname (e.g. `chat.example.com`, no `https://`, no port). `RP_ORIGIN`/`CORS_ALLOWED_ORIGINS` must be the full origin (`https://chat.example.com`). Passkeys silently fail if these don't exactly match what the browser sends — see [Passkey/WebAuthn Setup](#passkeywebauthn-setup).
7. **HTTPS is required** for WebAuthn and for `SESSION_COOKIE_SECURE=true` cookies to be sent — both Vercel and Render provide this by default.

### Path B — Full Docker Compose on a single host

Already documented above under [Docker Quick Start](#docker-quick-start-full-stack). For real public traffic on this path:

- Put a real TLS certificate in front of the `nginx` service (e.g. swap the bundled `nginx/nginx.conf` `listen 80` for `listen 443 ssl` with certs from Let's Encrypt/certbot, or terminate TLS at a load balancer in front of this stack and keep nginx on plain HTTP internally).
- Set `SESSION_COOKIE_SECURE=true` and `WEBAUTHN_ORIGIN`/`ALLOWED_ORIGINS` to your real `https://` domain once TLS is in place.
- Attachments stay on local disk by default here (the `attachment_data` named volume already persists them across container restarts) — switch to `ATTACHMENT_STORAGE_BACKEND=s3` only if you want offsite/durable storage instead.

## Database Migrations

Migrations are managed with Alembic (`backend/alembic/versions/`), applied via a dedicated one-shot `migrate` service in Docker Compose, never automatically on backend container boot — this avoids two backend replicas racing to apply the same migration.

**Create a new migration** (after changing a model in `backend/app/models/`):

```bash
cd backend
../.venv/bin/python -m alembic revision -m "describe the change"
# edit the generated file in alembic/versions/, write upgrade() and downgrade()
```

This project does not use `--autogenerate` blindly — write `upgrade()`/`downgrade()` deliberately, since autogenerate can miss data backfills (see `005_message_attachment_links.py` for an example that both creates a table and backfills existing data).

**Apply migrations locally:**

```bash
cd backend
DATABASE_URL=postgresql+asyncpg://chat:chatpass@localhost:5432/chatdb ../.venv/bin/python -m alembic upgrade head
```

**Apply migrations in production:**

- Docker Compose path: handled automatically — the `migrate` service runs `alembic upgrade head` and the `backend` service won't start until it exits successfully (`depends_on: migrate: condition: service_completed_successfully`).
- Render/managed path: run `python -m alembic upgrade head` as a pre-deploy command or one-off job against `DATABASE_URL`, before the new backend revision receives traffic. Never let request-handling backend instances run migrations on startup — a rolling deploy can otherwise apply a migration twice or have an old instance running against a new schema mid-rollout.
- This project's migrations are purely additive/backfilling — none of them drop data. Treat any future migration that drops a column/table as requiring a manual backup first; there is no automatic destructive-migration guard.

**Fixing migration history issues:**

- "Can't locate revision" / `down_revision` mismatch: confirm `alembic_version` in the target database matches a revision that actually exists in `alembic/versions/` — this usually means a deploy ran migrations from a different branch. Check out the correct branch and re-run `upgrade head`; do not hand-edit `alembic_version` unless you fully understand the revision graph.
- Multiple heads: run `python -m alembic heads` to see them, then `python -m alembic merge -m "merge heads" <rev1> <rev2>` to create a merge revision.
- The CI `migration-check` job (`.github/workflows/ci.yml`) runs `alembic upgrade head` against a throwaway Postgres on every PR, specifically to catch a broken migration before it reaches `main`.

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

Attachment storage (see [File Attachments](#file-attachments) and [Production Deployment](#production-deployment)):

```env
# local (default) — fine for Docker Compose, which backs it with a volume
ATTACHMENT_STORAGE_BACKEND=local
ATTACHMENT_STORAGE_DIR=uploads/attachments

# s3 — required on platforms without a persistent/shared disk (e.g. Render)
ATTACHMENT_STORAGE_BACKEND=s3
S3_BUCKET=your-bucket-name
S3_REGION=auto
S3_ENDPOINT_URL=https://<account-id>.r2.cloudflarestorage.com   # omit for AWS S3
S3_ACCESS_KEY_ID=...
S3_SECRET_ACCESS_KEY=...
```

The backend validates this at startup, not on first upload: setting `ATTACHMENT_STORAGE_BACKEND=s3` without the bucket/credentials fails fast with a clear `ValueError` instead of a 500 on the first file someone sends.

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

### What the message bubble shows instead of a generic "Decryption failed"

A failed message bubble shows one of these specific reasons (`frontend/src/lib/decryptionErrors.ts`), not just the word "failed":

| Message shown | Real cause | Recoverable on this device? |
|---|---|---|
| "This browser has no local encryption keys — cannot decrypt this message." | No identity key in IndexedDB at all. | No — set up encryption keys first; even then, only new messages going forward. |
| "Cannot decrypt: this message was encrypted for a different device/key." | No Double Ratchet session for this room/peer, and it's not the session's first message either. | No, unless this device had the session before it was lost. |
| "Cannot decrypt: the key used for this message is no longer available on this device." | The one-time prekey or signed prekey used for this message's X3DH handshake has since been consumed/rotated away. | No — one-time prekeys are deleted after first use by design (forward secrecy). |
| "Cannot decrypt: too many messages were missed to recover this one." | More than the ratchet's skip limit were missed in this chain. | No. |
| "Cannot decrypt: message header is missing or corrupted." | `encrypted_header` is missing or not valid base64url/JSON. | Possibly a transport bug — file an issue with the (redacted) stage logs, not a key-loss case. |
| "Decryption failed." (fallback) | AES-256-GCM auth tag mismatch — wrong key or corrupted ciphertext, doesn't match any of the above. | No. |

These are genuinely different failure modes with different implications, which is why they're not collapsed into one string — see [Known Limitations](#known-limitations) for why most of them are permanent on this device once they happen.

## Group Chat Design

MVP group chat uses pairwise encryption per recipient:

1. Alice writes one plaintext group message.
2. The browser encrypts that plaintext separately for Alice, Bob, Carol, and every other member.
3. The backend stores one ciphertext row per recipient.
4. The backend validates membership for create, add, leave, read, and send.
5. Each recipient only receives the row addressed to them.

This is simple and preserves the ciphertext-only backend rule. It is less efficient than Sender Keys because a group with `N` members stores `N` encrypted payloads per message.

Future roadmap: add Sender Keys for efficient group encryption after the MVP is stable.

## File Attachments

Images (PNG, JPEG, WebP, GIF, up to 10 MB each) can be attached to any direct or group message, with or without accompanying text.

**Sending:**

1. Click the image icon next to the message box and pick one or more files (or remove a selected file with the `×` on its chip before sending).
2. On send, the client encrypts each file locally with a random per-file key, uploads the encrypted blob to `POST /api/v1/rooms/{room_id}/attachments`, and gets back an opaque `attachment_id`.
3. The file's per-file key and the `attachment_id` are embedded inside the same encrypted message envelope as the text (so an attachment-only message just has empty `text`). The server only ever sees ciphertext plus an `attachment_ids` list — never the file key.
4. In a group chat, the file is uploaded **once** but the message envelope referencing it is encrypted separately for every recipient and sent as one row per recipient. The same `attachment_id` is linked to every one of those rows, so it survives a page reload for everyone, not just whoever's row got created first.

**Receiving:** the message bubble decrypts the envelope, then fetches and decrypts the attachment blob using the embedded key to render an inline image preview with a download button.

**Access control:** downloading an attachment (`GET /api/v1/attachments/{id}/blob`) requires being a member of the room the attachment belongs to; uploading/linking an attachment to a message requires being the original uploader. Unrelated users get a `403`.

**Storage backend:** where the encrypted blob physically lives is configurable and doesn't change any of the above — see `ATTACHMENT_STORAGE_BACKEND` in [Environment Variables](#environment-variables) and [Production Deployment](#production-deployment).

**If a download fails**, the attachment preview shows one of these specific reasons (`frontend/src/lib/attachmentErrors.ts`), never a generic "check your connection":

| Message shown | HTTP status | Real cause |
|---|---|---|
| "Session expired. Please log in again." | `401` | No/invalid session cookie. |
| "You are not allowed to download this attachment." | `403` | You're not a member of the room this attachment belongs to. |
| "Attachment not found." | `404` | No attachment row with that ID. |
| "This file is no longer available on the server." | `410` | The row exists and you're authorized, but the encrypted blob itself is gone from storage. |
| "Downloaded file could not be decrypted with this device's key." | `200` (download succeeded) | The encrypted bytes downloaded fine, but `crypto.subtle.decrypt` failed — wrong/missing per-file key on this device, or corrupted ciphertext. Not a network problem. |
| "Server error while loading the attachment. Please try again." | `5xx` | An actual backend failure. |
| "Network error. Check that the backend is running." | *(fetch threw, no response at all)* | DNS/connection refused/CORS rejection — the only case this message is accurate for. |

These are deliberately distinguished because a 403 and a decryption failure look identical to a naive try/catch but need completely different fixes — see `backend/app/api/messages.py::get_attachment_blob` for the exact exception each status maps to.

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
npm run lint
npx tsc --noEmit
npm test -- --run
npm run build
```

Docker images build correctly (no push):

```bash
docker build -t chat-backend:ci ./backend
docker build -t chat-frontend:ci ./frontend
```

### Manually validating receiver attachment downloads and old-message decryption

These two scenarios depend on real browser crypto/IndexedDB state, so they aren't fully covered by the automated suite above — backend permission/status-code logic is (`backend/app/tests/test_messages.py`), and the frontend error-classification logic is (`frontend/src/lib/attachmentErrors.test.ts`, `frontend/src/lib/decryptionErrors.test.ts`), but the end-to-end browser behavior needs a manual pass:

1. **Receiver can download a valid image:** as sender, attach an image to a message; as receiver (a different browser profile/window), open the chat, confirm the inline preview renders, then click the download icon and confirm the saved file opens correctly as the original image (proves both backend authorization and client-side decrypt succeeded).
2. **Receiver sees a real error, not a generic one, when download fails:** temporarily break one path on purpose and confirm the *specific* message from the table above appears — e.g. stop the backend (`network`), or query the DB and delete the attachment's row (`not_found`), or have a third unrelated account try the same `attachment.url` (`forbidden`).
3. **Old message with a lost/mismatched key shows a specific reason, not "Decryption failed":** as receiver, run `clearAllKeys()` from the browser console (or log out, which calls it) to simulate lost local keys, refresh, and open a chat with prior history — confirm the bubble shows one of the specific reasons from the decryption-failure table above, and that re-sending/receiving a *new* message after that works again (proving new messages aren't blocked by old-message failures).
4. **Text + image messages still work together:** send one message with both text and an attached image; confirm the receiver sees both the decrypted text and the working image preview in the same bubble.

## CI/CD

`.github/workflows/ci.yml` runs on every push/PR to `main`:

- **backend** — `ruff check` + `pytest` (in-memory SQLite + fakeredis, no external services needed)
- **migration-check** — spins up a real ephemeral Postgres service container and runs `alembic upgrade head` against it, to catch a broken migration before merge
- **frontend** — `eslint`, `tsc --noEmit`, `vitest run`, `vite build`
- **docker-build** — builds both `backend/Dockerfile` and `frontend/Dockerfile` (build-only, no push/registry needed)
- **secret-scan** — fails the build if `.env`/`*.pem`/`*.key`/`*.cert` are tracked by git, or if a tracked file matches an obvious AWS-key or private-key pattern

There is intentionally no `deploy.yml`: deployment for Path A (Vercel/Render) is push-to-deploy on those platforms themselves once connected to this repo, and Path B (Docker Compose) is a manual `docker compose up --build -d` on whatever host you control — adding a generic deploy workflow here would either be a no-op or encode assumptions about credentials/hosts this repo doesn't have.

## Troubleshooting Guide

`Failed to fetch` in the browser console when using the app at `http://localhost:5173`:

- This almost always means the backend at `http://localhost:8000` isn't actually reachable or isn't healthy — check `curl http://localhost:8000/health/ready` first. If it returns `degraded` with a Postgres/Redis connection error, you're hitting the [port-mismatch trap](#local-development-setup): `docker-compose.dev.yml` runs Postgres/Redis on `5433`/`6380`, not the defaults, so the natively-run backend needs `backend/.env` (copied from `backend/.env.example`) to point at the right ports.
- If `/health/ready` is `ready` but the browser still fails, confirm the backend process was *restarted* after creating/editing `backend/.env` — `uvicorn --reload` reloads on code changes, not env changes, and `Settings()` is cached at import time.
- Confirm nothing else is already bound to port 8000 (`lsof -i :8000`) — a stale backend process from an earlier session can keep serving on the old config while you edit env files that never take effect.

Browser console shows `Refused to connect because it violates the document's Content Security Policy` / a `connect-src` CSP error:

- This is a different failure mode than `Failed to fetch` above — the request never leaves the browser at all, so checking backend health won't show anything. The frontend is a static SPA (no FastAPI involvement at all in serving it), so its CSP lives in a `<meta http-equiv="Content-Security-Policy">` tag in `frontend/index.html`, **not** in any backend middleware or `nginx.conf` for local dev — there's no FastAPI security-headers code that affects the document the browser actually loaded.
- `connect-src` in that meta tag includes `%VITE_API_URL%` and `%VITE_WS_URL%` — Vite replaces these placeholders with the resolved env value at build/serve time (its built-in [HTML env replacement](https://vitejs.dev/guide/env-and-mode.html#html-env-replacement)), so the CSP automatically allows whatever backend origin `frontend/.env.development` / `frontend/.env.production` (or your hosting platform's project env vars) actually point at — `http://localhost:8000` and `ws://localhost:8000/ws` in local dev. You should not need to hand-edit the CSP string itself; if the backend moves to a different host/port, update the `VITE_API_URL`/`VITE_WS_URL` env var instead.
- Verify what the browser is actually receiving: `curl -s http://localhost:5173/ | grep Content-Security-Policy` — if you see the literal text `%VITE_API_URL%` un-replaced, the dev server needs a restart (`npm run dev`) so it picks up a newly-created/edited `frontend/.env.development`.
- The same-origin Docker/nginx deployment (`docker-compose.yml`) deliberately builds with `VITE_API_URL`/`VITE_WS_URL` empty (frontend and backend share one origin via nginx), so those placeholders resolve to nothing there and `'self'` already covers it — that's expected, not a bug.
- This is unrelated to CORS — CORS (`CORS_ALLOWED_ORIGINS` / `ALLOWED_ORIGINS` in `backend/.env`) controls whether the *server* accepts a cross-origin request; CSP `connect-src` controls whether the *browser* will even attempt it. Both already allow `http://localhost:5173` ↔ `http://localhost:8000` out of the box in this repo's dev config — if you've changed ports, both may need updating, not just one.

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

## Key Storage and Old-Message Recovery

**Where keys live:** all private key material (`identity`, `signed_prekeys`, `one_time_prekeys`, ratchet `sessions`, cached `message_keys`) lives in one IndexedDB database per browser — `crypt_keys_v1`, see `frontend/src/crypto/keyStore.ts`. It is never sent to the server, never in `localStorage`/`sessionStorage`, and never logged.

**This store is per-browser, not per-account.** There is exactly one `identity` record, full stop — it is not namespaced by which user is currently logged in. If you log into a *different* account in the same browser **without** logging out first (logout calls `clearAllKeys()`), the app will silently reuse whatever identity is already sitting in IndexedDB and re-upload its public key under the new account. Always log out properly before switching accounts in the same browser; use separate browser profiles/incognito windows for testing multiple accounts side-by-side instead.

**Why old messages stop decrypting — this is by design, not a bug:**

- Logging out (`clearAllKeys()`), clearing browser storage, or opening the app in a different browser/profile wipes or skips the IndexedDB store entirely.
- One-time prekeys are deleted immediately after their single use (that's what makes forward secrecy work) — if the message that consumed one is ever re-delivered or re-decrypted later without the cached session, there is no way to redo that handshake.
- The Double Ratchet only keeps a bounded window of skipped message keys; once a chain has advanced far enough, an old message key for that point is no longer derivable.
- None of this is fixable server-side: the server never has the private keys needed to recover anything, by design (see [Security Model](#security-model)).

**What this means in practice (Option A — local-only keys, no multi-device, no server-side escrow):**

- If you still have the *same* browser, *same* profile, and never logged out / cleared storage, all history decrypts normally.
- If local keys were lost, **new** messages work again as soon as a new identity is generated and uploaded — the chat UI shows an amber warning banner (not a success toast) when this happens for an account that already had conversation history, explaining that older messages may now be permanently unreadable on this device. Look for: *"This browser does not have the encryption keys needed to read older messages..."*
- There is currently no key export/import (backup) feature and no multi-device support. If you need either, see [Future Roadmap](#future-roadmap) — these are real, scoped follow-up features, not implemented here yet.

## Known Limitations

- Crypto implementation is educational and unaudited.
- Multi-device encrypted sync is not implemented.
- Group chat uses pairwise per-recipient encryption, so large groups are inefficient.
- If a browser loses IndexedDB private keys, old messages are permanently undecryptable on that device — see [Key Storage and Old-Message Recovery](#key-storage-and-old-message-recovery).
- Attachments are encrypted client-side but use the same local-key availability constraints as messages.
- The local key store is scoped to the browser, not the logged-in account — switching accounts without logging out first can cross-wire identities (see above).

## Future Roadmap

- Sender Keys protocol for efficient group encryption
- Multi-device key sync and device lists
- Passphrase-protected key export/import for backup and account recovery across devices
- Per-account scoping of the local IndexedDB key store (currently one identity per browser, not per account — see [Key Storage and Old-Message Recovery](#key-storage-and-old-message-recovery))
- Encrypted file sharing improvements
- Signed prekey rotation UI and OPK replenishment UX
- Stronger audit logging around ciphertext-only invariants
