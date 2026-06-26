/**
 * Classifies why an attachment failed to load/download so the UI can show
 * an accurate message instead of a generic "check your connection" /
 * "Attachment unavailable" catch-all that hides what actually happened
 * (wrong permissions, the file being gone, a bad local key, or a real
 * network failure all look identical to a naive try/catch).
 */
export type AttachmentFailureReason =
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "gone"
  | "decrypt_failed"
  | "server_error"
  | "network"
  | "unknown";

export function classifyHttpStatus(status: number): AttachmentFailureReason {
  if (status === 401) return "unauthenticated";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 410) return "gone";
  if (status >= 500) return "server_error";
  return "unknown";
}

export function attachmentFailureMessage(reason: AttachmentFailureReason): string {
  switch (reason) {
    case "unauthenticated":
      return "Session expired. Please log in again.";
    case "forbidden":
      return "You are not allowed to download this attachment.";
    case "not_found":
      return "Attachment not found.";
    case "gone":
      return "This file is no longer available on the server.";
    case "decrypt_failed":
      return "Downloaded file could not be decrypted with this device's key.";
    case "server_error":
      return "Server error while loading the attachment. Please try again.";
    case "network":
      return "Network error. Check that the backend is running.";
    case "unknown":
    default:
      return "Could not load this attachment.";
  }
}
