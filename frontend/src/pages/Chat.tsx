import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, LogOut, Plus, Shield, X } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";

import { useAuthStore } from "@/stores/authStore";
import { useMessageStore } from "@/stores/messageStore";
import { usePresenceStore, useUIStore } from "@/stores/presenceStore";
import { useRoomStore } from "@/stores/roomStore";

import { authService } from "@/services/authService";
import { keyService } from "@/services/keyService";
import { messageService, type EncryptedMessagePayload } from "@/services/messageService";
import { roomService } from "@/services/roomService";
import { wsService } from "@/services/websocketService";

import {
  clearAllKeys,
  decryptMessage,
  encryptInitialDirectMessage,
  encryptMessage,
} from "@/crypto/cryptoService";
import { encryptAttachmentFile } from "@/lib/attachmentCrypto";
import {
  createMessageEnvelope,
  decodeMessageEnvelope,
  encodeMessageEnvelope,
  type ClientAttachmentRef,
  type MessageEnvelope,
} from "@/lib/messageEnvelope";

import { ChatHeader } from "@/components/chat/ChatHeader";
import { ConversationList } from "@/components/chat/ConversationList";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { MessageInput } from "@/components/chat/MessageInput";
import { TypingIndicator } from "@/components/chat/TypingIndicator";
import { UserSearch } from "@/components/chat/UserSearch";
import { SecurityBadge } from "@/components/security/SecurityBadge";

import type { Message, Room } from "@/types/chat";
import type {
  WSEncryptedMessage,
  WSError,
  WSMessage,
  WSPresenceUpdate,
  WSReadReceipt,
  WSTyping,
} from "@/types/websocket";

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const ALLOWED_ATTACHMENT_TYPES = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"]);

export default function Chat() {
  const navigate = useNavigate();
  const user = useAuthStore((s) => s.user);
  const setUser = useAuthStore((s) => s.setUser);

  const { rooms, activeRoomId, setRooms, setActiveRoom, getActiveRoom } = useRoomStore();
  const { messages, addMessage, setMessages, updateMessage, upsertMessage } = useMessageStore();
  const { setPresence, setTyping } = usePresenceStore();
  const { setConnectionStatus, sidebarOpen, setSidebarOpen } = useUIStore();

  const [showSearch, setShowSearch] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [editText, setEditText] = useState("");
  const [forwardingMessage, setForwardingMessage] = useState<Message | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const typingTimerRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const activeRoom = getActiveRoom();
  const roomMessages = activeRoomId ? (messages[activeRoomId] ?? []) : [];

  const resolveRecipient = useCallback(
    (room: Room): string | undefined => {
      if (!user || room.type !== "direct") return undefined;
      return room.members.find((member) => member.user_id !== user.id)?.user_id;
    },
    [user]
  );

  const encryptForRoom = useCallback(
    async (room: Room, plaintext: string) => {
      try {
        return await encryptMessage(room.id, plaintext);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!message.includes("No session") || room.type !== "direct") throw error;
        const recipientId = resolveRecipient(room);
        if (!recipientId) throw new Error("Cannot find the recipient for this direct room");
        const bundle = await keyService.getBundle(recipientId);
        return encryptInitialDirectMessage(room.id, plaintext, bundle);
      }
    },
    [resolveRecipient]
  );

  const decryptForDisplay = useCallback(async (message: Message): Promise<Message> => {
    if (message.is_deleted) return message;
    try {
      return { ...message, decryptedText: await decryptMessage(message.room_id, message) };
    } catch {
      return { ...message, decryptionFailed: true };
    }
  }, []);

  const uploadEncryptedAttachments = useCallback(
    async (roomId: string, files: File[]): Promise<ClientAttachmentRef[]> => {
      const refs: ClientAttachmentRef[] = [];
      for (const file of files) {
        if (!ALLOWED_ATTACHMENT_TYPES.has(file.type)) {
          throw new Error("Only PNG, JPEG, WebP, and GIF attachments are supported");
        }
        if (file.size > MAX_ATTACHMENT_BYTES) {
          throw new Error("Attachments must be 10 MB or smaller");
        }
        const encrypted = await encryptAttachmentFile(file);
        const uploaded = await messageService.uploadAttachment(roomId, encrypted.blob, {
          filename: file.name,
          mimeType: file.type,
          sizeBytes: encrypted.blob.size,
        });
        refs.push({
          id: uploaded.id,
          url: uploaded.url,
          filename: file.name,
          mimeType: file.type,
          sizeBytes: file.size,
          key: encrypted.key,
          nonce: encrypted.nonce,
          localUrl: URL.createObjectURL(file),
        });
      }
      return refs;
    },
    []
  );

  const cloneAttachmentsForRoom = useCallback(
    async (targetRoomId: string, attachments: ClientAttachmentRef[]): Promise<ClientAttachmentRef[]> => {
      const refs: ClientAttachmentRef[] = [];
      for (const attachment of attachments) {
        const response = await fetch(attachment.url, { credentials: "include" });
        if (!response.ok) throw new Error(`Could not load attachment ${attachment.filename}`);
        const encryptedBlob = await response.blob();
        const uploaded = await messageService.uploadAttachment(targetRoomId, encryptedBlob, {
          filename: attachment.filename,
          mimeType: attachment.mimeType,
          sizeBytes: encryptedBlob.size,
        });
        refs.push({
          ...attachment,
          id: uploaded.id,
          url: uploaded.url,
          localUrl: undefined,
        });
      }
      return refs;
    },
    []
  );

  const sendEnvelope = useCallback(
    async (room: Room, envelope: MessageEnvelope, tempId: string, existingMessage?: Message) => {
      if (!user) return;
      const plaintext = encodeMessageEnvelope(envelope);
      const optimistic: Message = {
        id: tempId,
        room_id: room.id,
        sender_id: user.id,
        recipient_id: resolveRecipient(room),
        ciphertext: existingMessage?.ciphertext ?? "",
        encrypted_header: existingMessage?.encrypted_header,
        nonce: existingMessage?.nonce ?? "",
        algorithm: "AES-256-GCM",
        transport: wsService.isConnected ? "websocket" : "stored",
        delivery_status: "sending",
        forwarded_from_message_id: existingMessage?.forwarded_from_message_id,
        is_deleted: false,
        created_at: existingMessage?.created_at ?? new Date().toISOString(),
        decryptedText: plaintext,
      };
      upsertMessage(room.id, optimistic, existingMessage?.id);

      try {
        const encrypted = await encryptForRoom(room, plaintext);
        const payload: EncryptedMessagePayload = {
          client_message_id: tempId,
          recipient_id: resolveRecipient(room),
          ciphertext: encrypted.ciphertext,
          encrypted_header: encrypted.encryptedHeader,
          nonce: encrypted.nonce,
          algorithm: encrypted.algorithm,
          attachment_ids: envelope.attachments.map((attachment) => attachment.id),
        };

        const sentOverWs = wsService.send({
          type: "encrypted_message",
          room_id: room.id,
          ...payload,
        });

        if (!sentOverWs) {
          const saved = await messageService.send(room.id, payload);
          upsertMessage(room.id, { ...saved, decryptedText: plaintext, delivery_status: "sent" }, tempId);
        }
      } catch (error) {
        updateMessage(room.id, tempId, { delivery_status: "failed" });
        throw error;
      }
    },
    [encryptForRoom, resolveRecipient, updateMessage, upsertMessage, user]
  );

  const applyIncomingMessage = useCallback(
    async (event: WSEncryptedMessage) => {
      const message: Message = {
        id: event.message_id,
        client_message_id: event.client_message_id,
        room_id: event.room_id,
        sender_id: event.sender_id,
        recipient_id: event.recipient_id ?? undefined,
        ciphertext: event.ciphertext,
        encrypted_header: event.encrypted_header ?? undefined,
        nonce: event.nonce,
        algorithm: event.algorithm,
        transport: "websocket",
        delivery_status: event.delivery_status ?? "delivered",
        forwarded_from_message_id: event.forwarded_from_message_id,
        is_deleted: event.is_deleted,
        created_at: event.created_at ?? new Date().toISOString(),
        edited_at: event.edited_at,
        deleted_at: event.deleted_at,
        delivered_at: event.delivered_at ?? undefined,
        read_at: event.read_at ?? undefined,
        attachments: event.attachments as Message["attachments"],
      };

      const existing = useMessageStore.getState().messages[event.room_id]?.find(
        (item) => item.id === event.client_message_id || item.id === event.message_id
      );
      const display =
        existing?.decryptedText && existing.sender_id === user?.id
          ? { ...message, decryptedText: existing.decryptedText }
          : await decryptForDisplay(message);

      upsertMessage(event.room_id, display, event.client_message_id);
      if (event.sender_id !== user?.id) {
        wsService.send({ type: "delivery_receipt", room_id: event.room_id, message_id: event.message_id });
      }
      if (event.room_id === activeRoomId && event.sender_id !== user?.id) {
        wsService.send({ type: "read_receipt", room_id: event.room_id, message_id: event.message_id });
        messageService.markRead(event.message_id).catch(() => {});
      }
    },
    [activeRoomId, decryptForDisplay, upsertMessage, user?.id]
  );

  const handleWsMessage = useCallback(
    async (msg: WSMessage) => {
      switch (msg.type) {
        case "encrypted_message":
        case "message_forwarded":
          await applyIncomingMessage(msg as WSEncryptedMessage);
          break;
        case "message_edited":
          await applyIncomingMessage(msg as WSEncryptedMessage);
          break;
        case "message_deleted": {
          const event = msg as WSEncryptedMessage;
          updateMessage(event.room_id, event.message_id, {
            is_deleted: true,
            deleted_at: event.deleted_at,
            ciphertext: event.ciphertext,
            encrypted_header: undefined,
            nonce: event.nonce,
          });
          break;
        }
        case "typing_start":
        case "typing_stop": {
          const typing = msg as WSTyping;
          setTyping(typing.room_id, typing.user_id, typing.type === "typing_start");
          const key = `${typing.room_id}:${typing.user_id}`;
          clearTimeout(typingTimerRef.current[key]);
          if (typing.type === "typing_start") {
            typingTimerRef.current[key] = setTimeout(
              () => setTyping(typing.room_id, typing.user_id, false),
              3000
            );
          }
          break;
        }
        case "presence_update": {
          const presence = msg as WSPresenceUpdate;
          setPresence(presence.user_id, presence.status);
          break;
        }
        case "read_receipt":
        case "delivery_receipt": {
          const receipt = msg as WSReadReceipt;
          updateMessage(receipt.room_id, receipt.message_id, {
            delivery_status: receipt.status === "read" ? "read" : "delivered",
          });
          if (receipt.client_message_id) {
            updateMessage(receipt.room_id, receipt.client_message_id, {
              delivery_status: receipt.status === "read" ? "read" : "delivered",
            });
          }
          break;
        }
        case "error": {
          const error = msg as WSError;
          if (error.client_message_id && activeRoomId) {
            updateMessage(activeRoomId, error.client_message_id, { delivery_status: "failed" });
          }
          toast.error(error.detail || "Message operation failed");
          break;
        }
      }
    },
    [activeRoomId, applyIncomingMessage, setPresence, setTyping, updateMessage]
  );

  useEffect(() => {
    if (!user) {
      navigate("/login");
      return;
    }

    roomService.list().then(setRooms).catch((error) => toast.error(String(error)));

    wsService.connect();
    setConnectionStatus("relay");

    return () => {
      wsService.disconnect();
    };
  }, [navigate, setConnectionStatus, setRooms, user]);

  useEffect(() => {
    if (!user) return;
    return wsService.onMessage(handleWsMessage);
  }, [handleWsMessage, user]);

  useEffect(() => {
    if (!activeRoomId) return;
    setLoadingMessages(true);
    messageService
      .list(activeRoomId)
      .then(async (data) => {
        const decrypted = await Promise.all(data.messages.map(decryptForDisplay));
        setMessages(activeRoomId, decrypted);
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : "Could not load messages"))
      .finally(() => setLoadingMessages(false));
  }, [activeRoomId, decryptForDisplay, setMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [roomMessages.length]);

  const handleSend = useCallback(
    async (text: string, files: File[]) => {
      if (!activeRoom || !user) return;
      setIsSending(true);
      try {
        const attachments = await uploadEncryptedAttachments(activeRoom.id, files);
        await sendEnvelope(
          activeRoom,
          createMessageEnvelope(text, attachments),
          `temp-${Date.now()}`
        );
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Message failed to send");
      } finally {
        setIsSending(false);
      }
    },
    [activeRoom, sendEnvelope, uploadEncryptedAttachments, user]
  );

  const openEdit = useCallback((message: Message) => {
    setEditingMessage(message);
    setEditText(decodeMessageEnvelope(message.decryptedText).text);
  }, []);

  const saveEdit = useCallback(async () => {
    if (!editingMessage) return;
    const room = rooms.find((item) => item.id === editingMessage.room_id);
    if (!room) return;
    try {
      const existingEnvelope = decodeMessageEnvelope(editingMessage.decryptedText);
      const envelope = createMessageEnvelope(
        editText.trim(),
        existingEnvelope.attachments,
        existingEnvelope.forwarded
      );
      const plaintext = encodeMessageEnvelope(envelope);
      const encrypted = await encryptForRoom(room, plaintext);
      const saved = await messageService.edit(editingMessage.id, {
        recipient_id: editingMessage.recipient_id,
        ciphertext: encrypted.ciphertext,
        encrypted_header: encrypted.encryptedHeader,
        nonce: encrypted.nonce,
        algorithm: encrypted.algorithm,
      });
      upsertMessage(room.id, { ...saved, decryptedText: plaintext }, editingMessage.id);
      setEditingMessage(null);
      setEditText("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not edit message");
    }
  }, [editText, editingMessage, encryptForRoom, rooms, upsertMessage]);

  const deleteMessage = useCallback(
    async (message: Message) => {
      try {
        const deleted = await messageService.delete(message.id);
        upsertMessage(message.room_id, { ...deleted, decryptedText: undefined }, message.id);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not delete message");
      }
    },
    [upsertMessage]
  );

  const forwardToRoom = useCallback(
    async (targetRoomId: string) => {
      if (!forwardingMessage || !user) return;
      const targetRoom = rooms.find((room) => room.id === targetRoomId);
      if (!targetRoom) return;
      try {
        const sourceEnvelope = decodeMessageEnvelope(forwardingMessage.decryptedText);
        const attachments = await cloneAttachmentsForRoom(targetRoomId, sourceEnvelope.attachments);
        const envelope = createMessageEnvelope(sourceEnvelope.text, attachments, true);
        const plaintext = encodeMessageEnvelope(envelope);
        const encrypted = await encryptForRoom(targetRoom, plaintext);
        const tempId = `temp-${Date.now()}`;
        const optimistic: Message = {
          id: tempId,
          room_id: targetRoom.id,
          sender_id: user.id,
          recipient_id: resolveRecipient(targetRoom),
          ciphertext: "",
          nonce: "",
          algorithm: "AES-256-GCM",
          transport: "stored",
          delivery_status: "sending",
          forwarded_from_message_id: forwardingMessage.id,
          is_deleted: false,
          created_at: new Date().toISOString(),
          decryptedText: plaintext,
        };
        addMessage(targetRoom.id, optimistic);
        const saved = await messageService.forward(forwardingMessage.id, targetRoom.id, {
          client_message_id: tempId,
          recipient_id: resolveRecipient(targetRoom),
          ciphertext: encrypted.ciphertext,
          encrypted_header: encrypted.encryptedHeader,
          nonce: encrypted.nonce,
          algorithm: encrypted.algorithm,
          attachment_ids: attachments.map((attachment) => attachment.id),
        });
        upsertMessage(targetRoom.id, { ...saved, decryptedText: plaintext }, tempId);
        setForwardingMessage(null);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not forward message");
      }
    },
    [
      addMessage,
      cloneAttachmentsForRoom,
      encryptForRoom,
      forwardingMessage,
      resolveRecipient,
      rooms,
      upsertMessage,
      user,
    ]
  );

  const resendMessage = useCallback(
    async (message: Message) => {
      const room = rooms.find((item) => item.id === message.room_id);
      if (!room) return;
      try {
        await sendEnvelope(room, decodeMessageEnvelope(message.decryptedText), message.id, message);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not resend message");
      }
    },
    [rooms, sendEnvelope]
  );

  const handleTypingStart = useCallback(() => {
    if (activeRoomId) wsService.send({ type: "typing_start", room_id: activeRoomId });
  }, [activeRoomId]);

  const handleTypingStop = useCallback(() => {
    if (activeRoomId) wsService.send({ type: "typing_stop", room_id: activeRoomId });
  }, [activeRoomId]);

  const handleLogout = useCallback(async () => {
    await authService.logout();
    await clearAllKeys();
    setUser(null);
    navigate("/login");
  }, [setUser, navigate]);

  const typingState = usePresenceStore((s) => s.typing);
  const typingInRoom = activeRoomId ? [...(typingState[activeRoomId] ?? [])] : [];
  const typingNames = typingInRoom
    .filter((id) => id !== user?.id)
    .map((id) => activeRoom?.members.find((m) => m.user_id === id)?.user?.display_name ?? "Someone");

  if (!user) return null;

  return (
    <div className="flex h-screen bg-void overflow-hidden">
      <AnimatePresence>
        {sidebarOpen && (
          <motion.aside
            initial={{ x: -280 }}
            animate={{ x: 0 }}
            exit={{ x: -280 }}
            transition={{ type: "spring", stiffness: 300, damping: 30 }}
            className="w-72 flex-shrink-0 glass border-r border-border flex flex-col"
          >
            <div className="flex items-center justify-between px-4 py-4 border-b border-border">
              <div className="flex items-center gap-2">
                <div className="w-7 h-7 rounded-lg bg-cyan/10 border border-cyan/30 flex items-center justify-center">
                  <Shield size={13} className="text-cyan" />
                </div>
                <span className="font-display font-semibold text-sm text-text-primary">Crypt</span>
              </div>
              <button
                onClick={() => setShowSearch(true)}
                title="New conversation"
                className="w-7 h-7 rounded-lg flex items-center justify-center text-text-muted hover:text-cyan hover:bg-cyan/10 transition-all"
              >
                <Plus size={15} />
              </button>
            </div>

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

            <div className="flex items-center justify-between px-4 py-2 border-b border-border">
              <SecurityBadge size="sm" />
              <span className="text-xs font-mono text-text-muted">zero-knowledge</span>
            </div>

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

      <main className="flex-1 flex flex-col min-w-0">
        {activeRoom ? (
          <>
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

            <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-3">
              {loadingMessages ? (
                <MessageSkeleton />
              ) : (
                roomMessages.map((message) => (
                  <MessageBubble
                    key={message.id}
                    message={message}
                    isMine={message.sender_id === user.id}
                    senderName={
                      activeRoom.type === "group"
                        ? activeRoom.members.find((member) => member.user_id === message.sender_id)?.user?.display_name
                        : undefined
                    }
                    onEdit={openEdit}
                    onDelete={deleteMessage}
                    onForward={setForwardingMessage}
                    onResend={resendMessage}
                  />
                ))
              )}
              <TypingIndicator usernames={typingNames} />
              <div ref={bottomRef} />
            </div>

            <MessageInput
              onSend={handleSend}
              onTypingStart={handleTypingStart}
              onTypingStop={handleTypingStop}
              busy={isSending}
            />
          </>
        ) : (
          <EmptyState onNewChat={() => setShowSearch(true)} />
        )}
      </main>

      <AnimatePresence>
        {showSearch && (
          <ModalShell onClose={() => setShowSearch(false)}>
            <UserSearch
              onClose={() => setShowSearch(false)}
              onRoomCreated={(id) => {
                setActiveRoom(id);
                setShowSearch(false);
              }}
            />
          </ModalShell>
        )}
        {editingMessage && (
          <ModalShell onClose={() => setEditingMessage(null)}>
            <div className="w-full max-w-md rounded-lg border border-border bg-panel p-4 shadow-panel">
              <ModalHeader title="Edit Message" onClose={() => setEditingMessage(null)} />
              <textarea
                value={editText}
                onChange={(event) => setEditText(event.target.value)}
                className="input-field min-h-28 resize-none"
              />
              <div className="mt-3 flex justify-end gap-2">
                <button className="btn-ghost" onClick={() => setEditingMessage(null)}>
                  Cancel
                </button>
                <button className="btn-primary" onClick={saveEdit} disabled={!editText.trim()}>
                  Save
                </button>
              </div>
            </div>
          </ModalShell>
        )}
        {forwardingMessage && (
          <ModalShell onClose={() => setForwardingMessage(null)}>
            <div className="w-full max-w-md rounded-lg border border-border bg-panel p-4 shadow-panel">
              <ModalHeader title="Forward To" onClose={() => setForwardingMessage(null)} />
              <div className="mt-2 max-h-80 overflow-y-auto">
                {rooms
                  .filter((room) => room.id !== forwardingMessage.room_id)
                  .map((room) => (
                    <button
                      key={room.id}
                      className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm text-text-secondary hover:bg-surface hover:text-text-primary"
                      onClick={() => forwardToRoom(room.id)}
                    >
                      <span>{roomLabel(room, user.id)}</span>
                      <span className="font-mono text-xs text-text-muted">{room.type}</span>
                    </button>
                  ))}
              </div>
            </div>
          </ModalShell>
        )}
      </AnimatePresence>
    </div>
  );
}

function ModalShell({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-start justify-center bg-void/60 px-4 pt-24 backdrop-blur-sm"
      onClick={(event) => event.target === event.currentTarget && onClose()}
    >
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
      >
        {children}
      </motion.div>
    </motion.div>
  );
}

function ModalHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="font-display text-base font-semibold text-text-primary">{title}</h2>
      <button
        type="button"
        title="Close"
        onClick={onClose}
        className="flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-surface hover:text-cyan"
      >
        <X size={15} />
      </button>
    </div>
  );
}

function roomLabel(room: Room, currentUserId: string): string {
  if (room.type === "group") return `${room.members.length} members`;
  const other = room.members.find((member) => member.user_id !== currentUserId);
  return other?.user?.display_name ?? "Direct conversation";
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
          before it leaves.
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
      {[...Array(5)].map((_, index) => (
        <div key={index} className={`flex ${index % 2 === 0 ? "justify-start" : "justify-end"}`}>
          <div className="h-10 w-48 rounded-2xl bg-panel border border-border" />
        </div>
      ))}
    </div>
  );
}
