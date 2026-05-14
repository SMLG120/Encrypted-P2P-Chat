export interface ClientAttachmentRef {
  id: string;
  url: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  key: string;
  nonce: string;
  localUrl?: string;
}

export interface MessageEnvelope {
  v: 1;
  text: string;
  attachments: ClientAttachmentRef[];
  forwarded?: boolean;
}

export function createMessageEnvelope(
  text: string,
  attachments: ClientAttachmentRef[] = [],
  forwarded = false
): MessageEnvelope {
  return {
    v: 1,
    text,
    attachments,
    forwarded: forwarded || undefined,
  };
}

export function encodeMessageEnvelope(envelope: MessageEnvelope): string {
  return JSON.stringify(envelope);
}

export function decodeMessageEnvelope(value?: string): MessageEnvelope {
  if (!value) return createMessageEnvelope("");
  try {
    const parsed = JSON.parse(value) as Partial<MessageEnvelope>;
    if (parsed.v === 1 && typeof parsed.text === "string") {
      return {
        v: 1,
        text: parsed.text,
        attachments: Array.isArray(parsed.attachments) ? parsed.attachments : [],
        forwarded: parsed.forwarded || undefined,
      };
    }
  } catch {
    // Older messages were encrypted as raw text. Treat them as a text-only envelope.
  }
  return createMessageEnvelope(value);
}
