import { create } from "zustand";
import type { Room } from "@/types/chat";

interface RoomStore {
  rooms: Room[];
  activeRoomId: string | null;
  setRooms: (rooms: Room[]) => void;
  addRoom: (room: Room) => void;
  setActiveRoom: (roomId: string | null) => void;
  getActiveRoom: () => Room | undefined;
}

export const useRoomStore = create<RoomStore>((set, get) => ({
  rooms: [],
  activeRoomId: null,
  setRooms: (rooms) => set({ rooms }),
  addRoom: (room) =>
    set((s) => {
      if (s.rooms.find((r) => r.id === room.id)) return s;
      return { rooms: [room, ...s.rooms] };
    }),
  setActiveRoom: (roomId) => set({ activeRoomId: roomId }),
  getActiveRoom: () => get().rooms.find((r) => r.id === get().activeRoomId),
}));
