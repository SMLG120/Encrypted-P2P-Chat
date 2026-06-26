import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, CheckCircle2, ChevronLeft, Loader2, LogOut, Plus, Shield, Users, X } from "lucide-react";
import { clsx } from "clsx";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";

import { useAuthStore, type EncryptionSetupStatus } from "@/stores/authStore";
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
  ensureLocalIdentity,
  rememberMessageKeyAlias,
} from "@/crypto/cryptoService";
import { encryptAttachmentFile } from "@/lib/attachmentCrypto";
import { classifyDecryptionError } from "@/lib/decryptionErrors";
import {
  createMessageEnvelope,
  decodeMessageEnvelope,
  encodeMessageEnvelope,
  type ClientAttachmentRef,
  type MessageEnvelope,
} from "@/lib/messageEnvelope";

import { ChatHeader } from "@/components/chat/ChatHeader";
import { ConversationList } from "@/components/chat/ConversationList";
import { DeleteMessageDialog } from "@/components/chat/DeleteMessageDialog";
import { EditMessageInput } from "@/components/chat/EditMessageInput";
import { ForwardMessageModal } from "@/components/chat/ForwardMessageModal";
import { AddMemberModal } from "@/components/chat/AddMemberModal";
import { GroupChatHeader } from "@/components/chat/GroupChatHeader";
import { GroupMemberList } from "@/components/chat/GroupMemberList";
import { MessageBubble } from "@/components/chat/MessageBubble";
import { MessageInput } from "@/components/chat/MessageInput";
import { NewGroupModal } from "@/components/chat/NewGroupModal";
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
  const encryptionSetupStatus = useAuthStore((s) => s.encryptionSetupStatus);
  const encryptionSetupError = useAuthStore((s) => s.encryptionSetupError);
  const isEncryptionReady = useAuthStore((s) => s.isEncryptionReady);
  const setEncryptionSetupStatus = useAuthStore((s) => s.setEncryptionSetupStatus);
  const setEncryptionSetupError = useAuthStore((s) => s.setEncryptionSetupError);

  const { rooms, activeRoomId, setRooms, setActiveRoom, getActiveRoom } = useRoomStore();
  const { messages, setMessages, updateMessage, upsertMessage } = useMessageStore();
  const { setPresence, setTyping } = usePresenceStore();
  const { setConnectionStatus, sidebarOpen, setSidebarOpen } = useUIStore();

  const [showSearch, setShowSearch] = useState(false);
  const [showNewGroup, setShowNewGroup] = useState(false);
  const [showAddMember, setShowAddMember] = useState(false);
  const [showMembers, setShowMembers] = useState(false);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [editingMessage, setEditingMessage] = useState<Message | null>(null);
  const [deletingMessage, setDeletingMessage] = useState<Message | null>(null);
  const [editText, setEditText] = useState("");
  const [forwardingMessage, setForwardingMessage] = useState<Message | null>(null);
  const [showEncryptionReadyBanner, setShowEncryptionReadyBanner] = useState(false);
  const [identityHistoryWarning, setIdentityHistoryWarning] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const typingTimerRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const encryptionSetupPromiseRef = useRef<Promise<boolean> | null>(null);
  const messageLoadSeqRef = useRef(0);

  const activeRoom = getActiveRoom();
  const roomMessages = activeRoomId ? (messages[activeRoomId] ?? []) : [];

  const resolveRecipient = useCallback(
    (room: Room): string | undefined => {
      if (!user || room.type !== "direct") return undefined;
      return room.members.find((member) => member.user_id !== user.id)?.user_id;
    },
    [user]
  );

  const peerIdForMessage = useCallback(
    (message: Message): string | undefined => {
      if (!user) return undefined;
      if (message.sender_id === user.id) return message.recipient_id ?? user.id;
      return message.sender_id;
    },
    [user]
  );

  const encryptForPeer = useCallback(
    async (room: Room, plaintext: string, peerId?: string, localMessageId?: string) => {
      const targetPeerId = peerId ?? resolveRecipient(room);
      if (!targetPeerId) throw new Error("Cannot find the recipient for this room");
      try {
        return await encryptMessage(room.id, plaintext, localMessageId, targetPeerId);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("No local identity key")) {
          throw new Error("Missing local encryption keys");
        }
        if (message.includes("No session")) {
          console.debug("fetching prekey bundle");
          const bundle = await keyService.getBundle(targetPeerId);
          return encryptInitialDirectMessage(room.id, plaintext, bundle, localMessageId, targetPeerId);
        }
        throw error;
      }
    },
    [resolveRecipient]
  );

  const decryptForDisplay = useCallback(async (message: Message): Promise<Message> => {
    if (message.is_deleted) return message;
    const peerId = peerIdForMessage(message);
    try {
      console.debug("attempting decrypt with peer_id");
      return { ...message, decryptedText: await decryptMessage(message.room_id, message, peerId) };
    } catch (error) {
      return {
        ...message,
        decryptionFailed: true,
        decryptionFailureReason: classifyDecryptionError(error),
      };
    }
  }, [peerIdForMessage]);

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
        recipient_id: room.type === "group" ? user.id : resolveRecipient(room),
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
        if (room.type === "group") {
          const memberIds = room.members
            .map((member) => member.user_id)
            .filter((memberId) => memberId !== user.id);
          for (const memberId of memberIds) {
            const clientMessageId = `${tempId}:${memberId}`;
            const encrypted = await encryptForPeer(room, plaintext, memberId, clientMessageId);
            const payload: EncryptedMessagePayload = {
              client_message_id: clientMessageId,
              recipient_id: memberId,
              ciphertext: encrypted.ciphertext,
              encrypted_header: encrypted.encryptedHeader,
              nonce: encrypted.nonce,
              algorithm: encrypted.algorithm,
              attachment_ids: envelope.attachments.map((attachment) => attachment.id),
            };
            assertEncryptedPayload(payload);

            const sentOverWs = wsService.send({
              type: "encrypted_message",
              room_id: room.id,
              ...payload,
            });

            if (!sentOverWs) {
              const saved = await messageService.sendGroupMessage(room.id, payload);
              await rememberMessageKeyAlias(room.id, clientMessageId, saved.id, memberId);
            }
          }
          updateMessage(room.id, tempId, { delivery_status: "sent" });
          return;
        }

        const recipientId = resolveRecipient(room);
        const encrypted = await encryptForPeer(room, plaintext, recipientId, tempId);
        const payload: EncryptedMessagePayload = {
          client_message_id: tempId,
          recipient_id: recipientId,
          ciphertext: encrypted.ciphertext,
          encrypted_header: encrypted.encryptedHeader,
          nonce: encrypted.nonce,
          algorithm: encrypted.algorithm,
          attachment_ids: envelope.attachments.map((attachment) => attachment.id),
        };
        assertEncryptedPayload(payload);

        const sentOverWs = wsService.send({
          type: "encrypted_message",
          room_id: room.id,
          ...payload,
        });

        if (!sentOverWs) {
          const saved = await messageService.send(room.id, payload);
          await rememberMessageKeyAlias(room.id, tempId, saved.id, recipientId);
          upsertMessage(room.id, { ...saved, decryptedText: plaintext, delivery_status: "sent" }, tempId);
        }
      } catch (error) {
        updateMessage(room.id, tempId, { delivery_status: "failed" });
        throw error;
      }
    },
    [encryptForPeer, resolveRecipient, updateMessage, upsertMessage, user]
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

      console.debug("recipient received encrypted message");
      const peerId = peerIdForMessage(message);
      const existing = useMessageStore.getState().messages[event.room_id]?.find(
        (item) => item.id === event.client_message_id || item.id === event.message_id
      );
      if (event.client_message_id) {
        await rememberMessageKeyAlias(event.room_id, event.client_message_id, event.message_id, peerId);
      }
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
    [activeRoomId, decryptForDisplay, peerIdForMessage, upsertMessage, user?.id]
  );

  const handleWsMessage = useCallback(
    async (msg: WSMessage) => {
      switch (msg.type) {
        case "connected":
          setConnectionStatus("relay");
          break;
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
        case "error":
        case "message_error": {
          const error = msg as WSError;
          if (error.client_message_id) {
            const errorRoomId =
              activeRoomId ?? useMessageStore.getState().findRoomForClientMessageId(error.client_message_id);
            if (errorRoomId) {
              updateMessage(errorRoomId, error.client_message_id, { delivery_status: "failed" });
            }
          }
          toast.error(error.detail || "Message operation failed");
          break;
        }
      }
    },
    [activeRoomId, applyIncomingMessage, setConnectionStatus, setPresence, setTyping, updateMessage]
  );

  useEffect(() => {
    if (!user) {
      navigate("/login");
      return;
    }

    roomService.list().then(setRooms).catch((error) => toast.error(String(error)));

    wsService.connect();
    const unsubOpen = wsService.onOpen(() => setConnectionStatus("relay"));
    const unsubClose = wsService.onClose(() => setConnectionStatus("offline"));

    return () => {
      unsubOpen();
      unsubClose();
      wsService.disconnect();
      setConnectionStatus("offline");
    };
  }, [navigate, setConnectionStatus, setRooms, user]);

  useEffect(() => {
    if (!user) return;
    return wsService.onMessage(handleWsMessage);
  }, [handleWsMessage, user]);

  useEffect(() => {
    if (!activeRoomId) return;
    const loadSeq = ++messageLoadSeqRef.current;
    setLoadingMessages(true);
    messageService
      .list(activeRoomId)
      .then(async (data) => {
        if (messageLoadSeqRef.current !== loadSeq) return;
        const decrypted = await Promise.all(data.messages.map(decryptForDisplay));
        if (messageLoadSeqRef.current !== loadSeq) return;
        const current = useMessageStore.getState().messages[activeRoomId] ?? [];
        setMessages(activeRoomId, mergeMessagesById(decrypted, current));
      })
      .catch((error) => toast.error(error instanceof Error ? error.message : "Could not load messages"))
      .finally(() => {
        if (messageLoadSeqRef.current === loadSeq) setLoadingMessages(false);
      });
  }, [activeRoomId, decryptForDisplay, setMessages]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [roomMessages.length]);

  const ensureEncryptionKeys = useCallback(
    async (options: { force?: boolean; showReady?: boolean } = {}) => {
      if (!options.force && useAuthStore.getState().isEncryptionReady) return true;
      if (encryptionSetupPromiseRef.current) return encryptionSetupPromiseRef.current;

      const setupPromise = (async () => {
        setShowEncryptionReadyBanner(false);
        setIdentityHistoryWarning(false);
        setEncryptionSetupError(null);

        try {
          const result = await ensureLocalIdentity((bundle) => keyService.uploadBundle(bundle), {
            onStatus: setEncryptionSetupStatus,
          });
          setEncryptionSetupStatus("ready");

          if (result === "created") {
            // A brand-new identity was just generated on this browser. If
            // this account already has rooms/messages from before, those
            // older messages were encrypted for whatever identity existed
            // previously and CANNOT be decrypted with this new one — do not
            // present this as unconditional good news (see SECURITY.md).
            const existingRooms = await roomService.list().catch(() => []);
            if (existingRooms.length > 0) {
              setIdentityHistoryWarning(true);
              setShowEncryptionReadyBanner(true);
              toast.warning(
                "New encryption keys were created on this browser — older messages on this account may be unreadable.",
                { duration: 8000 }
              );
            } else {
              setShowEncryptionReadyBanner(true);
              toast.success("Encryption keys ready. You can now send secure messages.");
            }
          } else if (options.showReady) {
            setShowEncryptionReadyBanner(true);
            toast.success("Encryption keys ready. You can now send secure messages.");
          }
          return true;
        } catch {
          console.debug("encryption setup failed");
          setEncryptionSetupError("Could not set up encryption keys on this browser. Please refresh or try again.");
          setEncryptionSetupStatus("failed");
          return false;
        } finally {
          encryptionSetupPromiseRef.current = null;
        }
      })();

      encryptionSetupPromiseRef.current = setupPromise;
      return setupPromise;
    },
    [setEncryptionSetupError, setEncryptionSetupStatus]
  );

  useEffect(() => {
    if (!user) return;
    void ensureEncryptionKeys();
  }, [ensureEncryptionKeys, user]);

  useEffect(() => {
    if (!showEncryptionReadyBanner) return;
    const timer = setTimeout(() => setShowEncryptionReadyBanner(false), 5000);
    return () => clearTimeout(timer);
  }, [showEncryptionReadyBanner]);

  const handleSend = useCallback(
    async (text: string, files: File[]) => {
      if (!activeRoom || !user) return;
      if (!isEncryptionReady) {
        const ready = await ensureEncryptionKeys({ force: true, showReady: true });
        if (!ready) {
          toast.error(
            encryptionSetupStatus === "failed"
              ? "Encryption setup failed. Please retry before sending messages."
              : "Encryption keys are being prepared. Please wait."
          );
          return false;
        }
      }

      setIsSending(true);
      const tempId = `temp-${Date.now()}`;
      try {
        const attachments = await uploadEncryptedAttachments(activeRoom.id, files);
        const envelope = createMessageEnvelope(text, attachments);
        try {
          await sendEnvelope(activeRoom, envelope, tempId);
        } catch (error) {
          if (!isMissingLocalEncryptionKeysError(error)) throw error;
          const ready = await ensureEncryptionKeys({ force: true, showReady: true });
          if (!ready) throw error;
          await sendEnvelope(activeRoom, envelope, tempId);
        }
        return true;
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Message failed to send");
        return false;
      } finally {
        setIsSending(false);
      }
    },
    [
      activeRoom,
      encryptionSetupStatus,
      ensureEncryptionKeys,
      isEncryptionReady,
      sendEnvelope,
      uploadEncryptedAttachments,
      user,
    ]
  );

  const openEdit = useCallback((message: Message) => {
    setEditingMessage(message);
    setEditText(decodeMessageEnvelope(message.decryptedText).text);
  }, []);

  const saveEdit = useCallback(async () => {
    if (!editingMessage) return;
    const room = rooms.find((item) => item.id === editingMessage.room_id);
    if (!room) return;
    const previous = editingMessage;
    try {
      const existingEnvelope = decodeMessageEnvelope(editingMessage.decryptedText);
      const envelope = createMessageEnvelope(
        editText.trim(),
        existingEnvelope.attachments,
        existingEnvelope.forwarded
      );
      const plaintext = encodeMessageEnvelope(envelope);
      const peerId = peerIdForMessage(editingMessage);
      const encrypted = await encryptForPeer(room, plaintext, peerId, editingMessage.id);
      const editPayload: EncryptedMessagePayload = {
        recipient_id: editingMessage.recipient_id,
        ciphertext: encrypted.ciphertext,
        encrypted_header: encrypted.encryptedHeader,
        nonce: encrypted.nonce,
        algorithm: encrypted.algorithm,
      };
      assertEncryptedPayload(editPayload);
      updateMessage(room.id, editingMessage.id, {
        decryptedText: plaintext,
        delivery_status: "sending",
        edited_at: new Date().toISOString(),
      });
      const saved = await messageService.edit(editingMessage.id, editPayload);
      upsertMessage(room.id, { ...saved, decryptedText: plaintext }, editingMessage.id);
      setEditingMessage(null);
      setEditText("");
    } catch (error) {
      upsertMessage(room.id, previous, editingMessage.id);
      toast.error(error instanceof Error ? error.message : "Could not edit message");
    }
  }, [editText, editingMessage, encryptForPeer, peerIdForMessage, rooms, updateMessage, upsertMessage]);

  const confirmDeleteMessage = useCallback(
    async (message: Message) => {
      const previous = message;
      try {
        updateMessage(message.room_id, message.id, {
          is_deleted: true,
          decryptedText: undefined,
          delivery_status: "sending",
        });
        const deleted = await messageService.delete(message.id);
        upsertMessage(message.room_id, { ...deleted, decryptedText: undefined }, message.id);
        setDeletingMessage(null);
      } catch (error) {
        upsertMessage(message.room_id, previous, message.id);
        toast.error(error instanceof Error ? error.message : "Could not delete message");
      }
    },
    [updateMessage, upsertMessage]
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
        const tempId = `temp-${Date.now()}`;
        await sendEnvelope(targetRoom, envelope, tempId);
        setForwardingMessage(null);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not forward message");
      }
    },
    [
      cloneAttachmentsForRoom,
      forwardingMessage,
      rooms,
      sendEnvelope,
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

  const replaceRoom = useCallback(
    (room: Room) => {
      const currentRooms = useRoomStore.getState().rooms;
      setRooms(currentRooms.map((item) => (item.id === room.id ? room : item)));
    },
    [setRooms],
  );

  const removeGroupMember = useCallback(
    async (userId: string) => {
      if (!activeRoom || activeRoom.type !== "group") return;
      try {
        await roomService.removeGroupMember(activeRoom.id, userId);
        replaceRoom(await roomService.get(activeRoom.id));
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not remove member");
      }
    },
    [activeRoom, replaceRoom],
  );

  const leaveGroup = useCallback(async () => {
    if (!activeRoom || activeRoom.type !== "group" || !user) return;
    try {
      await roomService.leaveGroup(activeRoom.id, user.id);
      const nextRooms = useRoomStore.getState().rooms.filter((room) => room.id !== activeRoom.id);
      setRooms(nextRooms);
      setActiveRoom(nextRooms[0]?.id ?? null);
      setShowMembers(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not leave group");
    }
  }, [activeRoom, setActiveRoom, setRooms, user]);

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
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setShowSearch(true)}
                  title="New direct conversation"
                  className="w-7 h-7 rounded-md flex items-center justify-center text-text-muted hover:text-cyan hover:bg-cyan/10 transition-all"
                >
                  <Plus size={15} />
                </button>
                <button
                  onClick={() => setShowNewGroup(true)}
                  title="New group"
                  className="w-7 h-7 rounded-md flex items-center justify-center text-text-muted hover:text-cyan hover:bg-cyan/10 transition-all"
                >
                  <Users size={15} />
                </button>
              </div>
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
                {activeRoom.type === "group" ? (
                  <GroupChatHeader
                    room={activeRoom}
                    onAddMember={() => setShowAddMember(true)}
                    onShowMembers={() => setShowMembers(true)}
                  />
                ) : (
                  <ChatHeader room={activeRoom} currentUser={user} />
                )}
              </div>
            </div>

            <EncryptionSetupBanner
              status={encryptionSetupStatus}
              error={encryptionSetupError}
              showReady={showEncryptionReadyBanner}
              identityHistoryWarning={identityHistoryWarning}
              onRetry={() => void ensureEncryptionKeys({ force: true, showReady: true })}
            />

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
                    onDelete={setDeletingMessage}
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
              disabled={!isEncryptionReady}
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
        {showNewGroup && (
          <ModalShell onClose={() => setShowNewGroup(false)}>
            <NewGroupModal
              onClose={() => setShowNewGroup(false)}
              onRoomCreated={(id) => {
                setActiveRoom(id);
                setShowNewGroup(false);
              }}
            />
          </ModalShell>
        )}
        {showAddMember && activeRoom?.type === "group" && (
          <ModalShell onClose={() => setShowAddMember(false)}>
            <AddMemberModal
              room={activeRoom}
              onClose={() => setShowAddMember(false)}
              onMemberAdded={replaceRoom}
            />
          </ModalShell>
        )}
        {showMembers && activeRoom?.type === "group" && (
          <ModalShell onClose={() => setShowMembers(false)}>
            <GroupMemberList
              room={activeRoom}
              currentUser={user}
              onRemoveMember={removeGroupMember}
              onLeaveGroup={leaveGroup}
            />
          </ModalShell>
        )}
        {editingMessage && (
          <ModalShell onClose={() => setEditingMessage(null)}>
            <div className="w-full max-w-md rounded-lg border border-border bg-panel p-4 shadow-panel">
              <ModalHeader title="Edit Message" onClose={() => setEditingMessage(null)} />
              <EditMessageInput
                value={editText}
                onChange={setEditText}
                onCancel={() => setEditingMessage(null)}
                onSave={saveEdit}
              />
            </div>
          </ModalShell>
        )}
        {deletingMessage && (
          <ModalShell onClose={() => setDeletingMessage(null)}>
            <DeleteMessageDialog
              onCancel={() => setDeletingMessage(null)}
              onConfirm={() => confirmDeleteMessage(deletingMessage)}
            />
          </ModalShell>
        )}
        {forwardingMessage && (
          <ModalShell onClose={() => setForwardingMessage(null)}>
            <div className="w-full max-w-md rounded-lg border border-border bg-panel p-4 shadow-panel">
              <ModalHeader title="Forward To" onClose={() => setForwardingMessage(null)} />
              <ForwardMessageModal
                rooms={rooms}
                currentRoomId={forwardingMessage.room_id}
                currentUser={user}
                onForward={forwardToRoom}
              />
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

function EncryptionSetupBanner({
  status,
  error,
  showReady,
  identityHistoryWarning,
  onRetry,
}: {
  status: EncryptionSetupStatus;
  error: string | null;
  showReady: boolean;
  identityHistoryWarning: boolean;
  onRetry: () => void;
}) {
  if (status === "idle") return null;
  if (status === "ready" && !showReady && !error) return null;

  const failed = status === "failed";
  // A fresh identity was generated for an account that already has
  // conversation history — older messages were encrypted for whichever
  // identity existed before and cannot be decrypted with this new one.
  // This must not be presented as the same unconditional good news as a
  // first-time setup, so it gets its own (amber, not green) banner state.
  const warning = status === "ready" && identityHistoryWarning;
  const ready = status === "ready" && !warning;
  const loading = status === "checking" || status === "generating" || status === "uploading";

  const message =
    status === "checking"
      ? "Checking local encryption keys..."
      : status === "generating"
        ? "This browser has no local encryption keys. Generating secure encryption keys now..."
        : status === "uploading"
          ? "Uploading your public prekey bundle to the server..."
          : warning
            ? "This browser does not have the encryption keys needed to read older messages. New messages can work after creating a new identity, but older messages may remain unreadable unless you restore your keys."
            : status === "ready"
              ? "Encryption keys ready. You can now send secure messages."
              : "Could not set up encryption keys on this browser. Please refresh or try again.";

  return (
    <div
      className={clsx(
        "mx-6 mb-4 rounded-2xl border px-4 py-3 text-sm shadow-panel",
        failed && "border-rose/30 bg-rose/10 text-rose",
        ready && "border-emerald/30 bg-emerald/10 text-emerald",
        warning && "border-amber/30 bg-amber/10 text-amber",
        loading && "border-amber/30 bg-amber/10 text-amber"
      )}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center">
          {loading && <Loader2 size={16} className="animate-spin" />}
          {ready && <CheckCircle2 size={16} />}
          {(failed || warning) && <AlertTriangle size={16} />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-medium">{error ?? message}</p>
          {failed && (
            <button
              type="button"
              onClick={onRetry}
              className="mt-3 inline-flex items-center justify-center rounded-xl bg-cyan px-3 py-2 text-xs font-semibold text-void hover:bg-cyan/90"
            >
              Retry setup
            </button>
          )}
        </div>
      </div>
    </div>
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

function mergeMessagesById(fetched: Message[], existing: Message[]): Message[] {
  const byId = new Map(fetched.map((message) => [message.id, message]));
  for (const message of existing) {
    if (!byId.has(message.id)) byId.set(message.id, message);
  }
  return [...byId.values()].sort(
    (left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime(),
  );
}

function assertEncryptedPayload(payload: EncryptedMessagePayload): void {
  const record = payload as unknown as Record<string, unknown>;
  const plaintextFields = [
    "content",
    "text",
    "plaintext",
    "message_text",
    "decrypted",
    "decrypted_text",
    "decryptedText",
    "private_key",
    "privateKey",
    "ratchet_state",
    "ratchetState",
    "chain_key",
    "chainKey",
    "message_key",
    "messageKey",
  ];
  const leakedField = plaintextFields.find((field) => field in record);
  console.assert(
    !leakedField,
    "Outgoing message payload must not contain plaintext or private key fields"
  );
}

function isMissingLocalEncryptionKeysError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("Missing local encryption keys") || message.includes("No local identity key");
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
