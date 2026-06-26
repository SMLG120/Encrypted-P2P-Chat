/**
 * Classifies why decrypting a message failed, instead of collapsing every
 * cause into a single generic "Decryption failed". The distinction matters
 * because the fix is different for each: re-establishing a session vs.
 * accepting the message is permanently lost on this device vs. a real bug.
 *
 * Matched against the specific Error messages thrown by cryptoService.ts /
 * doubleRatchet.ts — see decryptMessage() and ratchetDecrypt().
 */
export type DecryptionFailureReason =
  | "no_identity"
  | "no_session"
  | "key_rotated"
  | "too_many_skipped"
  | "header"
  | "wrong_key";

export function classifyDecryptionError(error: unknown): DecryptionFailureReason {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("No local identity key")) return "no_identity";
  if (message.includes("No session for room") || message.includes("No receiving chain key")) {
    return "no_session";
  }
  if (message.includes("Signed prekey") && message.includes("not found")) return "key_rotated";
  if (message.includes("Unable to decrypt historical initial message")) return "key_rotated";
  if (message.includes("Too many skipped messages")) return "too_many_skipped";
  if (message.includes("Missing message header")) return "header";
  return "wrong_key";
}

export function decryptionFailureMessage(reason: DecryptionFailureReason): string {
  switch (reason) {
    case "no_identity":
      return "This browser has no local encryption keys — cannot decrypt this message.";
    case "no_session":
      return "Cannot decrypt: this message was encrypted for a different device/key.";
    case "key_rotated":
      return "Cannot decrypt: the key used for this message is no longer available on this device.";
    case "too_many_skipped":
      return "Cannot decrypt: too many messages were missed to recover this one.";
    case "header":
      return "Cannot decrypt: message header is missing or corrupted.";
    case "wrong_key":
    default:
      return "Decryption failed.";
  }
}
