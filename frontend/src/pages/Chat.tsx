import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, LogOut, Shield, ChevronLeft } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

import { useAuthStore } from "@/stores/authStore";
import { useRoomStore } from "@/stores/roomStore";
import { useMessageStore } from "@/stores/messageStore";
import { usePresenceStore } from "@/stores/presenceStore";
import { useUIStore } from "@/stores/presenceStore";

import { authService } from "@/services/authService";
import { roomService } from "@/services/roomService";
import { wsService } from "@/services/websocketService";
import { api } from "@/services/apiClient";

import { encryptMessage, decryptMessage } from "@/crypto/cryptoService";

import { ConversationList } from "@/components/chat/ConversationList";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { MessageInput } from "@/components/chat/MessageInput";
import { ChatHeader } from "@/components/chat/ChatHeader";
import { TypingIndicator } from "@/components/chat/TypingIndicator";
import { UserSearch } from "@/components/chat/UserSearch";
import { SecurityBadge } from "@/components/security/SecurityBadge";

import type { Message } from "@/types/chat";
import type { WSMessage, WSEncryptedMessage, WSTyping, WSPresenceUpdate, WSReadReceipt } from "@/types/websocket";
import { clearAllKeys } from "@/crypto/cryptoService";

export default function Chat() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);

  const { rooms, activeRoomId, setRooms, setActiveRoom, getActiveRoom } = useRoomStore();
  const { messages, addMessage, setMessages, updateMessage } = useMessageStore();
  const { setPresence, setTyping } = usePresenceStore();
  const { setConnectionStatus, sidebarOpen, setSidebarOpen } = useUIStore();

  const [showSearch, setShowSearch] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const typingTimerRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const activeRoom = getActiveRoom();
  const roomMessages = activeRoomId ? (messages[activeRoomId] ?? []) : [];

  // ── Bootstrap ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!user) { navigate("/login"); return; }

    roomService.list().then(setRooms).catch(console.error);

    wsService.connect();
    setConnectionStatus("relay");

    const unsub = wsService.onMessage(handleWsMessage);
    return () => {
      unsub();
      wsService.disconnect();
    };
  }, [user]);

  // ── Load messages when room changes ──────────────────────────────────────

  useEffect(() => {
    if (!activeRoomId) return;
    setLoadingMessages(true);
    api
      .get<{ messages: Message[]; total: number; has_more: boolean }>(
        `/rooms/${activeRoomId}/messages?limit=50`
      )
      .then(async (data) => {
        // Decrypt each message
        const decrypted = await Promise.all(
          data.messages.map(async (m) => {
            try {
              const text = await decryptMessage(activeRoomId, m);
              return { ...m, decryptedText: text };
            } catch {
              return { ...m, decryptionFailed: true };
            }
          })
        );
        setMessages(activeRoomId, decrypted);
      })
      .catch(console.error)
      .finally(() => setLoadingMessages(false));
  }, [activeRoomId]);

  // ── Scroll to bottom on new messages ────────────────────────────────────

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [roomMessages.length]);

  // ── WebSocket handler ─────────────────────────────────────────────────────

  const handleWsMessage = useCallback(
    async (msg: WSMessage) => {
      switch (msg.type) {
        case "encrypted_message": {
          const m = msg as WSEncryptedMessage;
          const newMsg: Message = {
            id: m.message_id,
            room_id: m.room_id,
            sender_id: m.sender_id,
            ciphertext: m.ciphertext,
            encrypted_header: m.encrypted_header,
            nonce: m.nonce,
            algorithm: m.algorithm,
            transport: "websocket",
            delivery_status: "delivered",
            created_at: m.created_at ?? new Date().toISOString(),
          };
          try {
            newMsg.decryptedText = await decryptMessage(m.room_id, newMsg);
          } catch {
            newMsg.decryptionFailed = true;
          }
          addMessage(m.room_id, newMsg);
          // Send read receipt if room is active
          if (m.room_id === activeRoomId) {
            wsService.send({ type: "read_receipt", room_id: m.room_id, message_id: m.message_id });
            api.patch(`/messages/${m.message_id}/read`).catch(() => {});
          }
          break;
        }
        case "typing_start":
        case "typing_stop": {
          const t = msg as WSTyping;
          setTyping(t.room_id, t.user_id, t.type === "typing_start");
          // Auto-clear typing after 3 s
          const key = `${t.room_id}:${t.user_id}`;
          clearTimeout(typingTimerRef.current[key]);
          if (t.type === "typing_start") {
            typingTimerRef.current[key] = setTimeout(
              () => setTyping(t.room_id, t.user_id, false),
              3000
            );
          }
          break;
        }
        case "presence_update": {
          const p = msg as WSPresenceUpdate;
          setPresence(p.user_id, p.status);
          break;
        }
        case "read_receipt": {
          const r = msg as WSReadReceipt;
          updateMessage(r.room_id, r.message_id, { delivery_status: "read" });
          break;
        }
      }
    },
    [activeRoomId, addMessage, setTyping, setPresence, updateMessage]
  );

  // ── Send message ──────────────────────────────────────────────────────────

  const handleSend = useCallback(
    async (text: string) => {
      if (!activeRoomId || !user) return;
      const room = getActiveRoom();
      const recipient = room?.members.find((m) => m.user_id !== user.id);

      // Optimistic message
      const tempId = `temp-${Date.now()}`;
      const optimistic: Message = {
        id: tempId,
        room_id: activeRoomId,
        sender_id: user.id,
        ciphertext: "",
        nonce: "",
        algorithm: "AES-256-GCM",
        transport: "websocket",
        delivery_status: "sending",
        created_at: new Date().toISOString(),
        decryptedText: text,
      };
      addMessage(activeRoomId, optimistic);

      try {
        const encrypted = await encryptMessage(activeRoomId, text);
        const result = await api.post<Message>(`/rooms/${activeRoomId}/messages`, {
          recipient_id: recipient?.user_id,
          ciphertext: encrypted.ciphertext,
          encrypted_header: encrypted.encryptedHeader,
          nonce: encrypted.nonce,
          algorithm: encrypted.algorithm,
        });
        updateMessage(activeRoomId, tempId, {
          ...result,
          decryptedText: text,
          delivery_status: "sent",
        });
      } catch {
        updateMessage(activeRoomId, tempId, { delivery_status: "failed" });
      }
    },
    [activeRoomId, user, getActiveRoom, addMessage, updateMessage]
  );

  // ── Typing signals ────────────────────────────────────────────────────────

  const handleTypingStart = useCallback(() => {
    if (activeRoomId) wsService.send({ type: "typing_start", room_id: activeRoomId });
  }, [activeRoomId]);

  const handleTypingStop = useCallback(() => {
    if (activeRoomId) wsService.send({ type: "typing_stop", room_id: activeRoomId });
  }, [activeRoomId]);

  // ── Logout ────────────────────────────────────────────────────────────────

  const handleLogout = useCallback(async () => {
    await authService.logout();
    await clearAllKeys();
    setUser(null);
    navigate("/login");
  }, [setUser, navigate]);

  // ── Typing indicator data ─────────────────────────────────────────────────

  const typingState = usePresenceStore((s) => s.typing);
  const typingInRoom = activeRoomId ? [...(typingState[activeRoomId] ?? [])] : [];
  const typingNames = typingInRoom
    .filter((id) => id !== user?.id)
    .map((id) => activeRoom?.members.find((m) => m.user_id === id)?.user?.display_name ?? "Someone");

  if (!user) return null;

  return (
    <div className="flex h-screen bg-void overflow-hidden">
      {/* ── Sidebar ─────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {sidebarOpen && (
          <motion.aside
            initial={{ x: -280 }}
            animate={{ x: 0 }}
            exit={{ x: -280 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="w-72 flex-shrink-0 glass border-r border-border flex flex-col"
          >
            {/* Sidebar header */}
            <div className="flex items-center justify-between px-4 py-4 border-b border-border">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-cyan/10 border border-cyan/30 flex items-center justify-center">
                  <Shield size={13} className="text-cyan" />
                </div>
                <span className="font-display font-semibold text-sm text-text-primary">Crypt</span>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setShowSearch(true)}
                  title="New conversation"
                  className="w-7 h-7 rounded-lg flex items-center justify-center
                             text-text-muted hover:text-cyan hover:bg-cyan/10 transition-all"
                >
                  <Plus size={15} />
                </button>
              </div>
            </div>

            {/* User info */}
            <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-cyan/30 to-emerald/30 flex items-center justify-center">
                <span className="text-xs font-semibold text-cyan">
                  {user.display_name[0]?.toUpperCase()}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text-primary truncate">{user.display_name}</p>
                <p className="text-xs text-text-muted font-mono truncate">@{user.username}</p>
              </div>
              <button
                onClick={handleLogout}
                title="Sign out"
                className="text-text-muted hover:text-rose transition-colors p-1"
              >
                <LogOut size={14} />
              </button>
            </div>

            {/* Security indicator */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-border">
              <SecurityBadge size="sm" />
              <span className="text-xs font-mono text-text-muted">zero-knowledge</span>
            </div>

            {/* Conversations */}
            <div className="flex-1 overflow-y-auto py-2">
              <ConversationList
                rooms={rooms}
                activeRoomId={activeRoomId}
                currentUser={user}
                onSelect={(id) => {
                  setActiveRoom(id);
                  setSidebarOpen(window.innerWidth > 768);
                }}
              />
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* ── Main chat area ─────────────────────────────────────────────── */}
      <main className="flex-1 flex flex-col min-w-0">
        {activeRoom ? (
          <>
            {/* Header */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setSidebarOpen(!sidebarOpen)}
                className="ml-3 mt-3 mb-3 p-2 text-text-muted hover:text-cyan transition-colors md:hidden"
              >
                <ChevronLeft size={18} />
              </button>
              <div className="flex-1">
                <ChatHeader room={activeRoom} currentUser={user} />
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-3">
              {loadingMessages ? (
                <MessageSkeleton />
              ) : (
                roomMessages.map((msg) => (
                  <MessageBubble
                    key={msg.id}
                    message={msg}
                    isMine={msg.sender_id === user.id}
                    senderName={
                      activeRoom.type === "group"
                        ? activeRoom.members.find((m) => m.user_id === msg.sender_id)?.user?.display_name
                        : undefined
                    }
                  />
                ))
              )}
              <TypingIndicator usernames={typingNames} />
              <div ref={bottomRef} />
            </div>

            {/* Input */}
            <MessageInput
              onSend={handleSend}
              onTypingStart={handleTypingStart}
              onTypingStop={handleTypingStop}
            />
          </>
        ) : (
          <EmptyState onNewChat={() => setShowSearch(true)} />
        )}
      </main>

      {/* User search modal */}
      <AnimatePresence>
        {showSearch && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-void/60 backdrop-blur-sm z-50 flex items-start justify-center pt-24 px-4"
            onClick={(e) => e.target === e.currentTarget && setShowSearch(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
            >
              <UserSearch
                onClose={() => setShowSearch(false)}
                onRoomCreated={(id) => { setActiveRoom(id); setShowSearch(false); }}
              />
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function EmptyState({ onNewChat }: { onNewChat: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-6 text-center px-8">
      <div className="w-20 h-20 rounded-2xl bg-cyan/5 border border-cyan/10 flex items-center justify-center animate-float">
        <Shield size={32} className="text-cyan/60" />
      </div>
      <div>
        <h2 className="text-xl font-display font-semibold text-text-primary mb-2">
          End-to-end encrypted
        </h2>
        <p className="text-sm text-text-secondary max-w-sm">
          Select a conversation or start a new one. Every message is encrypted on your device 
          before it leaves — the server never sees plaintext.
        </p>
      </div>
      <button onClick={onNewChat} className="btn-primary flex items-center gap-2">
        <Plus size={16} />
        New Conversation
      </button>
    </div>
  );
}

function MessageSkeleton() {
  return (
    <div className="flex flex-col gap-4 animate-pulse">
      {[...Array(5)].map((_, i) => (
        <div key={i} className={`flex ${i % 2 === 0 ? "justify-start" : "justify-end"}`}>
          <div className="h-10 w-48 rounded-2xl bg-panel border border-border" />
        </div>
      ))}
    </div>
  );
}
