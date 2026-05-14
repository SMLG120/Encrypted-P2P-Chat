import { describe, expect, it } from "vitest";

import {
  createMessageEnvelope,
  decodeMessageEnvelope,
  encodeMessageEnvelope,
} from "@/lib/messageEnvelope";

describe("messageEnvelope", () => {
  it("round-trips encrypted plaintext envelopes", () => {
    const envelope = createMessageEnvelope("hello", [
      {
        id: "att-1",
        url: "/api/v1/attachments/att-1/blob",
        filename: "cat.gif",
        mimeType: "image/gif",
        sizeBytes: 123,
        key: "key",
        nonce: "nonce",
      },
    ]);

    expect(decodeMessageEnvelope(encodeMessageEnvelope(envelope))).toEqual(envelope);
  });

  it("keeps older raw-text messages displayable", () => {
    expect(decodeMessageEnvelope("legacy text")).toEqual({
      v: 1,
      text: "legacy text",
      attachments: [],
      forwarded: undefined,
    });
  });
});
