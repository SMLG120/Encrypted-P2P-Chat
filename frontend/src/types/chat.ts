// Chat types
export interface Room {
  id: string;
  type: "direct" | "group";
  created_by: string | null;
  created_at: string;
  members: Membership[];
}

export interface Membership {
  user_id: string;
  role: "owner" | "member";
  joined_at: string;
  user?: {
    id: string;
    username: string;
    display_name: string;
    avatar_url?: string;
  };
}

export interface Message {
  id: string;
  room_id: string;
  sender_id: string;
  recipient_id?: string;
  ciphertext: string;
  encrypted_header?: string;
  nonce: string;
  algorithm: string;
  transport: "webrtc" | "websocket" | "stored";
  delivery_status: "sending" | "sent" | "delivered" | "read" | "failed";
  created_at: string;
  delivered_at?: string;
  read_at?: string;
  // Client-side decrypted content (never sent to server)
  decryptedText?: string;
  decryptionFailed?: boolean;
}

export interface PresenceState {
  [userId: string]: "online" | "offline" | "away";
}

export interface TypingState {
  [roomId: string]: Set<string>; // set of user_ids typing
}
