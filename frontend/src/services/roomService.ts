import { api } from "./apiClient";
import type { Room } from "@/types/chat";

export const roomService = {
  async create(type: "direct" | "group", memberIds: string[]): Promise<Room> {
    return api.post<Room>("/rooms", { type, member_ids: memberIds });
  },

  async createGroupRoom(name: string, memberIds: string[]): Promise<Room> {
    return api.post<Room>("/rooms/group", { name, member_ids: memberIds });
  },

  async list(): Promise<Room[]> {
    return api.get<Room[]>("/rooms");
  },

  async get(roomId: string): Promise<Room> {
    return api.get<Room>(`/rooms/${roomId}`);
  },

  async addGroupMember(roomId: string, userId: string): Promise<void> {
    await api.post(`/rooms/${roomId}/members`, { user_id: userId });
  },

  async removeGroupMember(roomId: string, userId: string): Promise<void> {
    await api.delete(`/rooms/${roomId}/members/${userId}`);
  },

  async leaveGroup(roomId: string, userId: string): Promise<void> {
    await api.delete(`/rooms/${roomId}/members/${userId}`);
  },

  async searchUsers(query: string) {
    return api.get<{
      users: Array<{ id: string; username: string; display_name: string; avatar_url?: string }>;
      total: number;
    }>(`/users/search?q=${encodeURIComponent(query)}`);
  },
};
