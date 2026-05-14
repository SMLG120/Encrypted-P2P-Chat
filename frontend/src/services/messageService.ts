import { api } from "@/services/apiClient";
import type { Attachment, Message } from "@/types/chat";

export interface EncryptedMessagePayload {
  recipient_id?: string;
  ciphertext: string;
  encrypted_header?: string;
  nonce: string;
  algorithm: string;
  attachment_ids?: string[];
  client_message_id?: string;
}

export const messageService = {
  list(roomId: string): Promise<{ messages: Message[]; total: number; has_more: boolean }> {
    return api.get(`/rooms/${roomId}/messages?limit=50`);
  },

  send(roomId: string, payload: EncryptedMessagePayload): Promise<Message> {
    return api.post(`/rooms/${roomId}/messages`, payload);
  },

  edit(messageId: string, payload: EncryptedMessagePayload): Promise<Message> {
    return api.patch(`/messages/${messageId}`, payload);
  },

  delete(messageId: string): Promise<Message> {
    return api.delete(`/messages/${messageId}`);
  },

  markRead(messageId: string): Promise<{ message: string }> {
    return api.patch(`/messages/${messageId}/read`);
  },

  forward(
    messageId: string,
    targetRoomId: string,
    payload: EncryptedMessagePayload
  ): Promise<Message> {
    return api.post(`/messages/${messageId}/forward`, {
      target_room_id: targetRoomId,
      payload,
      client_message_id: payload.client_message_id,
    });
  },

  uploadAttachment(roomId: string, file: Blob, metadata: {
    filename: string;
    mimeType: string;
    sizeBytes: number;
  }): Promise<Attachment> {
    const body = new FormData();
    body.append("file", file, `${metadata.filename}.encrypted`);
    body.append("filename", metadata.filename);
    body.append("mime_type", metadata.mimeType);
    body.append("size_bytes", String(metadata.sizeBytes));
    return api.form(`/rooms/${roomId}/attachments`, body);
  },
};
