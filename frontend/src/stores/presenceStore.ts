import { create } from "zustand";

interface PresenceStore {
  presence: Record<string, "online" | "offline" | "away">;
  typing: Record<string, Set<string>>;
  setPresence: (userId: string, status: "online" | "offline" | "away") => void;
  setTyping: (roomId: string, userId: string, isTyping: boolean) => void;
}

export const usePresenceStore = create<PresenceStore>((set) => ({
  presence: {},
  typing: {},
  setPresence: (userId, status) =>
    set((s) => ({ presence: { ...s.presence, [userId]: status } })),
  setTyping: (roomId, userId, isTyping) =>
    set((s) => {
      const current = new Set(s.typing[roomId] ?? []);
      if (isTyping) current.add(userId);
      else current.delete(userId);
      return { typing: { ...s.typing, [roomId]: current } };
    }),
}));

interface UIStore {
  toasts: Array<{ id: string; message: string; type: "success" | "error" | "info" }>;
  connectionStatus: "p2p" | "relay" | "offline";
  sidebarOpen: boolean;
  addToast: (message: string, type?: "success" | "error" | "info") => void;
  removeToast: (id: string) => void;
  setConnectionStatus: (status: "p2p" | "relay" | "offline") => void;
  setSidebarOpen: (open: boolean) => void;
}

export const useUIStore = create<UIStore>((set) => ({
  toasts: [],
  connectionStatus: "offline",
  sidebarOpen: true,
  addToast: (message, type = "info") => {
    const id = Math.random().toString(36).slice(2);
    set((s) => ({ toasts: [...s.toasts, { id, message, type }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 4000);
  },
  removeToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  setConnectionStatus: (connectionStatus) => set({ connectionStatus }),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
}));
