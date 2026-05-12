import { create } from "zustand";
import type { Message } from "@/types/chat";

interface MessageStore {
  messages: Record<string, Message[]>; // roomId → messages
  addMessage: (roomId: string, msg: Message) => void;
  setMessages: (roomId: string, msgs: Message[]) => void;
  updateMessage: (roomId: string, msgId: string, patch: Partial<Message>) => void;
  prependMessages: (roomId: string, msgs: Message[]) => void;
}

export const useMessageStore = create<MessageStore>((set) => ({
  messages: {},
  addMessage: (roomId, msg) =>
    set((s) => ({
      messages: {
        ...s.messages,
        [roomId]: [...(s.messages[roomId] ?? []), msg],
      },
    })),
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
  prependMessages: (roomId, msgs) =>
    set((s) => ({
      messages: {
        ...s.messages,
        [roomId]: [...msgs, ...(s.messages[roomId] ?? [])],
      },
    })),
}));
