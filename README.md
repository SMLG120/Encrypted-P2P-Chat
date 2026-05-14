# 🔐 Crypt — Zero-Knowledge Encrypted P2P Chat

A production-grade, end-to-end encrypted real-time messenger built as a portfolio demonstration of modern full-stack security engineering.

> **⚠️ Portfolio Disclaimer:** This application follows Signal-protocol cryptographic design but has **not been independently audited**. Do not use for communications where your safety depends on it. For that, use Signal or another audited messenger.

---

## ✨ Features

| Feature | Implementation |
|---------|---------------|
| **Passkey auth** | WebAuthn / FIDO2 (no passwords stored) |
| **E2EE** | X3DH key agreement + Double Ratchet per-message keys |
| **Key types** | X25519 DH, Ed25519 signing, AES-256-GCM encryption |
| **Forward secrecy** | One-time prekeys consumed atomically; ratchet advances every message |
| **P2P transport** | WebRTC DataChannels when both users online |
| **Relay fallback** | WebSocket relay with the same E2EE layer |
| **Offline delivery** | Ciphertext stored server-side, delivered on reconnect |
| **Presence** | Real-time online/offline via WebSocket |
| **Typing indicators** | Ephemeral, room-scoped |
| **Read receipts** | Per-message, synced via WebSocket |
| **Zero-knowledge server** | Server stores ciphertext, public keys, metadata — never plaintext |
| **Private key storage** | IndexedDB only — never sent to server |

---

## 🚀 Quick Start

### Docker

```bash
# 1. Clone
git clone https://github.com/yourname/encrypted-p2p-chat
cd encrypted-p2p-chat

# 2. Configure from the project-root template
cp .env.example .env
# Edit .env — at minimum set SECRET_KEY

# 3. Start Docker Desktop, then launch
docker compose up --build

# App available at http://localhost
```

If Docker reports that it cannot connect to `docker.sock`, Docker Desktop/the Docker daemon is not running yet.

### Local Development

The backend must run on Python 3.12. Do not reuse a virtualenv created with Python 3.13 or 3.14.

```bash
brew install python@3.12
rm -rf .venv
python3.12 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip setuptools wheel
pip install -r backend/requirements.txt

cd frontend
npm ci
cd ..
```

Run the dependency services with Docker, then start the app processes locally:

```bash
docker compose -f docker-compose.dev.yml up -d postgres redis

cd backend
../.venv/bin/python -m uvicorn app.main:app --reload --port 8000

cd ../frontend
npm run dev
```

---

## 🏗 Architecture

```
Browser (TypeScript + React)
├── crypto/        X3DH, Double Ratchet, AES-256-GCM, IndexedDB key store
├── services/      API client, WebSocket client, auth
├── stores/        Zustand: rooms, messages, presence, UI
└── pages/         Landing, Login, Register, Chat, SecurityModel

Nginx (reverse proxy + rate limiting + security headers)
│
├── /api/v1/*   → FastAPI (Python 3.12)
│                  ├── WebAuthn auth (py_webauthn)
│                  ├── Key bundle management (X3DH public material)
│                  ├── Room & membership management
│                  ├── Message storage (ciphertext only)
│                  └── WebSocket (presence, signaling, relay)
│
├── PostgreSQL   users, credentials, keys, rooms, messages (ciphertext)
└── Redis        sessions, WebAuthn challenges, presence TTL, rate limits
```

---

## 🔑 Cryptographic Design

### Key Hierarchy
```
Identity Key (IK)     X25519 — long-term DH key
Signing Key (SK_ed)   Ed25519 — signs prekeys
Signed Prekey (SPK)   X25519 — medium-term (7-day rotation)
One-Time Prekey (OPK) X25519 — single-use, consumed atomically
Ephemeral Key (EK)    X25519 — generated per session initiation
```

### X3DH Session Initiation
```
Alice                        Server                     Bob
  |                            |                          |
  |── fetch Bob's bundle ──────>|                          |
  |<─ IKb, SPKb, OPKb ─────────|                          |
  |                            |                          |
  |  DH1 = DH(IKa, SPKb)      |                          |
  |  DH2 = DH(EKa, IKb)       |                          |
  |  DH3 = DH(EKa, SPKb)      |                          |
  |  DH4 = DH(EKa, OPKb)      |                          |
  |  SK = HKDF(DH1||DH2||DH3||DH4)                       |
  |                            |                          |
  |── ciphertext + EKa pub ───>|── stored ───────────────>|
```

### Double Ratchet (per-message)
- Symmetric ratchet: each message derives a fresh AES-256-GCM key
- DH ratchet: new X25519 key pair on each reply, providing break-in recovery
- Skipped message keys stored locally for out-of-order delivery

---

## 📡 API Overview

```
POST /api/v1/auth/register/options   Get WebAuthn registration challenge
POST /api/v1/auth/register/verify    Verify registration, create user + session
POST /api/v1/auth/login/options      Get WebAuthn authentication challenge  
POST /api/v1/auth/login/verify       Verify assertion, set session cookie
POST /api/v1/auth/logout             Clear session
GET  /api/v1/auth/me                 Current user info

POST /api/v1/keys/upload             Upload public key bundle (post-registration)
GET  /api/v1/keys/bundle/:userId     Fetch key bundle for X3DH (consumes OPK)
GET  /api/v1/keys/status             Check local key health
POST /api/v1/keys/replenish          Upload more one-time prekeys

GET  /api/v1/users/search?q=         Search users
GET  /api/v1/users/:userId           Get user profile

POST /api/v1/rooms                   Create/get direct room
GET  /api/v1/rooms                   List your rooms
GET  /api/v1/rooms/:id               Room details + members

GET  /api/v1/rooms/:id/messages      Paginated message history (ciphertext)
POST /api/v1/rooms/:id/messages      Send encrypted message
PATCH /api/v1/messages/:id/read      Mark as read

WS   /ws                             Real-time: messages, typing, presence, WebRTC
```

---

## 🛡 Security Model

See [SECURITY.md](./SECURITY.md) for the full threat model.

**TL;DR — The server can see:**
- Who has an account
- Who talks to whom (room membership)
- Message timestamps and sizes
- Ciphertext (cannot decrypt)
- Public key material

**The server cannot see:**
- Message content (end-to-end encrypted)
- Private keys (generated and stored on-device only)

---

## 🧪 Running Tests

```bash
# Backend
source .venv/bin/activate
cd backend
python -m pytest app/tests/ -v --cov=app

# Frontend (unit)
cd frontend
npm ci
npm test

# E2E (requires running app)
npm run test:e2e
```

---

## 🧯 Troubleshooting

| Symptom | Fix |
|---------|-----|
| `asyncpg` or `pydantic-core` fails while building wheels on Python 3.14 | Recreate `.venv` with Python 3.12 using the local setup commands above. |
| `cp backend/.env.example .env` fails | Use `cp .env.example .env`; the template lives at the project root. |
| `npm ci` says a lockfile is required | `frontend/package-lock.json` must exist. If dependencies change, run `cd frontend && npm install --package-lock-only`. |
| Compose cannot connect to `docker.sock` | Start Docker Desktop/the Docker daemon, then rerun `docker compose up --build`. |
| Passkey verification fails in local dev | `WEBAUTHN_ORIGIN` must exactly match the browser origin. Use `http://localhost:5173` for Vite dev, `http://localhost` for Docker/nginx, and do not mix `localhost` with `127.0.0.1`. |

---

## 📦 Tech Stack

**Frontend:** TypeScript · React 18 · Vite · Tailwind CSS · Zustand · Framer Motion · @noble/curves · WebCrypto · IndexedDB

**Backend:** Python 3.12 · FastAPI · SQLAlchemy 2 (async) · Alembic · py_webauthn · structlog · slowapi

**Infrastructure:** PostgreSQL 16 · Redis 7 · Nginx · Docker Compose

---

## 📄 Resume Highlights

- Built a **zero-knowledge encrypted P2P chat platform** using FastAPI, TypeScript, WebAuthn/passkeys, WebRTC, and Signal-protocol E2EE (X3DH + Double Ratchet + AES-256-GCM)
- Designed a **client-side cryptographic key lifecycle** with X25519 identity keys, Ed25519 signatures, signed prekeys with 7-day rotation, single-use one-time prekeys with atomic SQL consumption, and IndexedDB private key storage — server stores only public material and ciphertext
- Implemented **real-time infrastructure** with WebSocket signaling, WebRTC DataChannel P2P transport, typing indicators, online presence tracking, read/delivery receipts, and Redis-backed session and rate-limit management  
- Containerized a **full-stack secure messaging system** with PostgreSQL, Redis, Nginx reverse proxy, Docker Compose, Alembic async migrations, structured logging with secret scrubbing, and a documented threat model
# Encrypted-P2P-Chat
