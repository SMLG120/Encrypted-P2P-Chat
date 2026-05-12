# Encrypted P2P Chat — Full File Tree

```
encrypted-p2p-chat/
├── README.md
├── SECURITY.md
├── ARCHITECTURE.md
├── DEPLOYMENT.md
├── CONTRIBUTING.md
├── LICENSE
├── Makefile
├── docker-compose.yml
├── docker-compose.dev.yml
├── .env.example
├── .gitignore
│
├── backend/
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── alembic.ini
│   ├── alembic/
│   │   ├── env.py
│   │   └── versions/
│   │       └── 001_initial.py
│   ├── app/
│   │   ├── main.py
│   │   ├── api/
│   │   │   ├── __init__.py
│   │   │   ├── auth.py
│   │   │   ├── users.py
│   │   │   ├── keys.py
│   │   │   ├── rooms.py
│   │   │   ├── messages.py
│   │   │   ├── websocket.py
│   │   │   └── health.py
│   │   ├── core/
│   │   │   ├── __init__.py
│   │   │   ├── config.py
│   │   │   ├── security.py
│   │   │   ├── dependencies.py
│   │   │   ├── rate_limit.py
│   │   │   ├── exceptions.py
│   │   │   ├── logging.py
│   │   │   ├── websocket_manager.py
│   │   │   └── passkey_manager.py
│   │   ├── models/
│   │   │   ├── __init__.py
│   │   │   ├── user.py
│   │   │   ├── credential.py
│   │   │   ├── identity_key.py
│   │   │   ├── signed_prekey.py
│   │   │   ├── one_time_prekey.py
│   │   │   ├── room.py
│   │   │   ├── membership.py
│   │   │   └── message.py
│   │   ├── schemas/
│   │   │   ├── __init__.py
│   │   │   ├── auth.py
│   │   │   ├── user.py
│   │   │   ├── keys.py
│   │   │   ├── room.py
│   │   │   ├── message.py
│   │   │   └── websocket.py
│   │   ├── services/
│   │   │   ├── __init__.py
│   │   │   ├── auth_service.py
│   │   │   ├── user_service.py
│   │   │   ├── key_service.py
│   │   │   ├── room_service.py
│   │   │   ├── message_service.py
│   │   │   ├── presence_service.py
│   │   │   └── signaling_service.py
│   │   ├── repositories/
│   │   │   ├── __init__.py
│   │   │   ├── user_repository.py
│   │   │   ├── key_repository.py
│   │   │   ├── room_repository.py
│   │   │   └── message_repository.py
│   │   └── tests/
│   │       ├── __init__.py
│   │       ├── conftest.py
│   │       ├── test_auth.py
│   │       ├── test_keys.py
│   │       ├── test_rooms.py
│   │       ├── test_messages.py
│   │       └── test_websocket.py
│
├── frontend/
│   ├── Dockerfile
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── tailwind.config.ts
│   ├── postcss.config.js
│   ├── index.html
│   └── src/
│       ├── main.tsx
│       ├── App.tsx
│       ├── crypto/
│       │   ├── primitives.ts
│       │   ├── identity.ts
│       │   ├── x3dh.ts
│       │   ├── doubleRatchet.ts
│       │   ├── keyStore.ts
│       │   ├── sessionStore.ts
│       │   └── cryptoService.ts
│       ├── components/
│       │   ├── auth/
│       │   │   ├── PasskeyButton.tsx
│       │   │   └── AuthCard.tsx
│       │   ├── chat/
│       │   │   ├── MessageBubble.tsx
│       │   │   ├── MessageInput.tsx
│       │   │   ├── ChatHeader.tsx
│       │   │   ├── ConversationList.tsx
│       │   │   ├── TypingIndicator.tsx
│       │   │   └── UserSearch.tsx
│       │   ├── layout/
│       │   │   ├── Sidebar.tsx
│       │   │   └── TopBar.tsx
│       │   ├── security/
│       │   │   ├── SecurityBadge.tsx
│       │   │   └── ConnectionStatus.tsx
│       │   └── ui/
│       │       ├── Toast.tsx
│       │       ├── Skeleton.tsx
│       │       └── Modal.tsx
│       ├── pages/
│       │   ├── Landing.tsx
│       │   ├── Login.tsx
│       │   ├── Register.tsx
│       │   ├── Chat.tsx
│       │   ├── SecurityModel.tsx
│       │   └── NotFound.tsx
│       ├── services/
│       │   ├── apiClient.ts
│       │   ├── authService.ts
│       │   ├── keyService.ts
│       │   ├── roomService.ts
│       │   └── websocketService.ts
│       ├── stores/
│       │   ├── authStore.ts
│       │   ├── roomStore.ts
│       │   ├── messageStore.ts
│       │   ├── presenceStore.ts
│       │   └── uiStore.ts
│       ├── types/
│       │   ├── auth.ts
│       │   ├── crypto.ts
│       │   ├── chat.ts
│       │   └── websocket.ts
│       └── lib/
│           ├── base64.ts
│           ├── date.ts
│           ├── validators.ts
│           └── errors.ts
│
└── nginx/
    └── nginx.conf
```
