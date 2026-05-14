// WebSocket message type union

export type WSMessageType =
  | "connected"
  | "encrypted_message"
  | "message_edited"
  | "message_deleted"
  | "message_forwarded"
  | "attachment_uploaded"
  | "typing_start"
  | "typing_stop"
  | "presence_update"
  | "read_receipt"
  | "delivery_receipt"
  | "webrtc_offer"
  | "webrtc_answer"
  | "webrtc_ice_candidate"
  | "message_error"
  | "error"
  | "heartbeat"
  | "heartbeat_ack";

export interface WSBase {
  type: WSMessageType;
}

export interface WSConnected extends WSBase {
  type: "connected";
  user_id: string;
}

export interface WSEncryptedMessage extends WSBase {
  type: "encrypted_message" | "message_edited" | "message_deleted" | "message_forwarded";
  room_id: string;
  message_id: string;
  client_message_id?: string;
  sender_id: string;
  recipient_id?: string | null;
  ciphertext: string;
  encrypted_header?: string | null;
  nonce: string;
  algorithm: string;
  created_at: string;
  edited_at?: string | null;
  deleted_at?: string | null;
  delivered_at?: string | null;
  read_at?: string | null;
  delivery_status: "sending" | "sent" | "delivered" | "read" | "failed";
  forwarded_from_message_id?: string | null;
  is_deleted?: boolean;
  attachments?: unknown[];
}

export interface WSTyping extends WSBase {
  type: "typing_start" | "typing_stop";
  room_id: string;
  user_id: string;
}

export interface WSPresenceUpdate extends WSBase {
  type: "presence_update";
  user_id: string;
  status: "online" | "offline" | "away";
}

export interface WSReadReceipt extends WSBase {
  type: "read_receipt" | "delivery_receipt";
  room_id: string;
  message_id: string;
  reader_id?: string;
  recipient_id?: string;
  status?: "delivered" | "read";
  client_message_id?: string;
}

export interface WSWebRTCOffer extends WSBase {
  type: "webrtc_offer";
  room_id: string;
  target_user_id: string;
  from_user_id: string;
  sdp: string;
}

export interface WSWebRTCAnswer extends WSBase {
  type: "webrtc_answer";
  room_id: string;
  target_user_id: string;
  from_user_id: string;
  sdp: string;
}

export interface WSWebRTCIce extends WSBase {
  type: "webrtc_ice_candidate";
  room_id: string;
  target_user_id: string;
  from_user_id: string;
  candidate: RTCIceCandidateInit;
}

export interface WSError extends WSBase {
  type: "error" | "message_error";
  code: string;
  detail: string;
  client_message_id?: string;
}

export interface WSAttachmentUploaded extends WSBase {
  type: "attachment_uploaded";
  id: string;
  room_id: string;
}

export type WSMessage =
  | WSConnected
  | WSEncryptedMessage
  | WSTyping
  | WSPresenceUpdate
  | WSReadReceipt
  | WSAttachmentUploaded
  | WSWebRTCOffer
  | WSWebRTCAnswer
  | WSWebRTCIce
  | WSError
  | WSBase;
