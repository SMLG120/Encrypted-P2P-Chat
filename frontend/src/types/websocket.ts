// WebSocket message type union

export type WSMessageType =
  | "encrypted_message"
  | "typing_start"
  | "typing_stop"
  | "presence_update"
  | "read_receipt"
  | "delivery_receipt"
  | "webrtc_offer"
  | "webrtc_answer"
  | "webrtc_ice_candidate"
  | "error"
  | "heartbeat"
  | "heartbeat_ack";

export interface WSBase {
  type: WSMessageType;
}

export interface WSEncryptedMessage extends WSBase {
  type: "encrypted_message";
  room_id: string;
  message_id: string;
  sender_id: string;
  ciphertext: string;
  encrypted_header?: string;
  nonce: string;
  algorithm: string;
  created_at: string;
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
  type: "read_receipt";
  room_id: string;
  message_id: string;
  reader_id: string;
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
  type: "error";
  code: string;
  detail: string;
}

export type WSMessage =
  | WSEncryptedMessage
  | WSTyping
  | WSPresenceUpdate
  | WSReadReceipt
  | WSWebRTCOffer
  | WSWebRTCAnswer
  | WSWebRTCIce
  | WSError
  | WSBase;
