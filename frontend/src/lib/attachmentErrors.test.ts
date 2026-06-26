import { describe, expect, it } from "vitest";
import { attachmentFailureMessage, classifyHttpStatus } from "./attachmentErrors";

describe("classifyHttpStatus", () => {
  it("maps 401 to unauthenticated", () => {
    expect(classifyHttpStatus(401)).toBe("unauthenticated");
  });

  it("maps 403 to forbidden", () => {
    expect(classifyHttpStatus(403)).toBe("forbidden");
  });

  it("maps 404 to not_found", () => {
    expect(classifyHttpStatus(404)).toBe("not_found");
  });

  it("maps 410 to gone", () => {
    expect(classifyHttpStatus(410)).toBe("gone");
  });

  it("maps 5xx to server_error", () => {
    expect(classifyHttpStatus(500)).toBe("server_error");
    expect(classifyHttpStatus(503)).toBe("server_error");
  });

  it("maps unrecognized statuses to unknown", () => {
    expect(classifyHttpStatus(418)).toBe("unknown");
  });
});

describe("attachmentFailureMessage", () => {
  it("gives a distinct, accurate message per reason — never the generic network message for non-network failures", () => {
    const reasons = [
      "unauthenticated",
      "forbidden",
      "not_found",
      "gone",
      "decrypt_failed",
      "server_error",
      "network",
      "unknown",
    ] as const;
    const messages = reasons.map(attachmentFailureMessage);
    expect(new Set(messages).size).toBe(messages.length);
    for (const reason of reasons) {
      if (reason !== "network") {
        expect(attachmentFailureMessage(reason).toLowerCase()).not.toContain("internet connection");
      }
    }
  });

  it("only blames the network/connection for an actual network-classified failure", () => {
    expect(attachmentFailureMessage("network")).toMatch(/network|backend/i);
    expect(attachmentFailureMessage("decrypt_failed")).toMatch(/decrypt/i);
    expect(attachmentFailureMessage("forbidden")).toMatch(/not allowed/i);
    expect(attachmentFailureMessage("not_found")).toMatch(/not found/i);
  });
});
