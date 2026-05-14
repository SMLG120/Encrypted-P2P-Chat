import { create } from "zustand";
import type { Message } from "@/types/chat";

interface MessageStore {
  messages: Record<string, Message[]>; // roomId → messages
  addMessage: (roomId: string, msg: Message) => void;
  upsertMessage: (roomId: string, msg: Message, replaceId?: string) => void;
  setMessages: (roomId: string, msgs: Message[]) => void;
  updateMessage: (roomId: string, msgId: string, patch: Partial<Message>) => void;
  removeMessage: (roomId: string, msgId: string) => void;
  prependMessages: (roomId: string, msgs: Message[]) => void;
}

export const useMessageStore = create<MessageStore>((set) => ({
  messages: {},
  addMessage: (roomId, msg) =>
    set((s) => ({
      messages: {
        ...s.messages,
        [roomId]: (s.messages[roomId] ?? []).some((m) => m.id === msg.id)
          ? (s.messages[roomId] ?? []).map((m) => (m.id === msg.id ? { ...m, ...msg } : m))
          : [...(s.messages[roomId] ?? []), msg],
      },
    })),
  upsertMessage: (roomId, msg, replaceId) =>
    set((s) => {
      const current = s.messages[roomId] ?? [];
      const index = current.findIndex((m) => m.id === msg.id || (replaceId && m.id === replaceId));
      const next = [...current];
      if (index >= 0) next[index] = { ...next[index], ...msg };
      else next.push(msg);
      return { messages: { ...s.messages, [roomId]: next } };
    }),
  setMessages: (roomId, msgs) =>
    set((s) => ({ messages: { ...s.messages, [roomId]: msgs } })),
  updateMessage: (roomId, msgId, patch) =>
    set((s) => ({
      messages: {
        ...s.messages,
        [roomId]: (s.messages[roomId] ?? []).map((m) =>
          m.id === msgId ? { ...m, ...patch } : m
        ),
      },
    })),
  removeMessage: (roomId, msgId) =>
    set((s) => ({
      messages: {
        ...s.messages,
        [roomId]: (s.messages[roomId] ?? []).filter((m) => m.id !== msgId),
      },
    })),
  prependMessages: (roomId, msgs) =>
    set((s) => ({
      messages: {
        ...s.messages,
        [roomId]: [...msgs, ...(s.messages[roomId] ?? [])],
      },
    })),
}));
