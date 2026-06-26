import { describe, expect, it } from "vitest";
import { classifyDecryptionError, decryptionFailureMessage } from "./decryptionErrors";

describe("classifyDecryptionError", () => {
  it("classifies a missing local identity", () => {
    expect(classifyDecryptionError(new Error("No local identity key"))).toBe("no_identity");
  });

  it("classifies a missing/lost ratchet session as a different-device mismatch", () => {
    expect(classifyDecryptionError(new Error("No session for room abc-123"))).toBe("no_session");
    expect(classifyDecryptionError(new Error("No receiving chain key"))).toBe("no_session");
  });

  it("classifies a rotated-away signed prekey", () => {
    expect(classifyDecryptionError(new Error("Signed prekey 4 not found"))).toBe("key_rotated");
  });

  it("classifies an old historical initial message that can't be re-derived", () => {
    expect(
      classifyDecryptionError(new Error("Unable to decrypt historical initial message on this device"))
    ).toBe("key_rotated");
  });

  it("classifies too many skipped ratchet steps", () => {
    expect(classifyDecryptionError(new Error("Too many skipped messages"))).toBe("too_many_skipped");
  });

  it("classifies a missing header", () => {
    expect(classifyDecryptionError(new Error("Missing message header"))).toBe("header");
  });

  it("falls back to wrong_key for an unrecognized failure (e.g. AES-GCM auth tag mismatch)", () => {
    expect(classifyDecryptionError(new Error("OperationError"))).toBe("wrong_key");
    expect(classifyDecryptionError("not even an Error instance")).toBe("wrong_key");
  });
});

describe("decryptionFailureMessage", () => {
  it("gives a distinct message per reason, never just the bare word 'failed'", () => {
    const reasons = ["no_identity", "no_session", "key_rotated", "too_many_skipped", "header", "wrong_key"] as const;
    const messages = reasons.map(decryptionFailureMessage);
    expect(new Set(messages).size).toBe(messages.length);
  });
});
