import { useEffect, useState } from "react";
import { AlertTriangle, Download, ImageIcon, Loader2 } from "lucide-react";

import { decryptAttachmentBlob } from "@/lib/attachmentCrypto";
import { attachmentFailureMessage, classifyHttpStatus, type AttachmentFailureReason } from "@/lib/attachmentErrors";
import type { ClientAttachmentRef } from "@/lib/messageEnvelope";

interface AttachmentPreviewProps {
  attachment: ClientAttachmentRef;
}

export function AttachmentPreview({ attachment }: AttachmentPreviewProps) {
  const [url, setUrl] = useState(attachment.localUrl ?? "");
  const [failureReason, setFailureReason] = useState<AttachmentFailureReason | null>(null);

  useEffect(() => {
    if (attachment.localUrl) {
      setUrl(attachment.localUrl);
      return;
    }

    let objectUrl = "";
    let cancelled = false;

    async function load() {
      let response: Response;
      try {
        response = await fetch(attachment.url, { credentials: "include" });
      } catch {
        // fetch() only throws for a genuine network-level failure (DNS,
        // connection refused, CORS rejection) — an HTTP error status does
        // NOT land here, it's a normal resolved response handled below.
        if (!cancelled) setFailureReason("network");
        return;
      }

      if (!response.ok) {
        if (!cancelled) setFailureReason(classifyHttpStatus(response.status));
        return;
      }

      const encryptedBlob = await response.blob();
      let blob: Blob;
      try {
        blob = await decryptAttachmentBlob(
          encryptedBlob,
          attachment.key,
          attachment.nonce,
          attachment.mimeType
        );
      } catch {
        // The encrypted bytes downloaded fine — this is a local-key
        // problem (wrong/missing device key for this attachment), not a
        // network issue, so it must not be reported as one.
        if (!cancelled) setFailureReason("decrypt_failed");
        return;
      }

      objectUrl = URL.createObjectURL(blob);
      if (!cancelled) setUrl(objectUrl);
    }

    load();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
    // Deliberately keyed on the attachment's stable identity, not the
    // `attachment` object reference: the parent re-creates a fresh
    // ClientAttachmentRef object on every chat re-render (typing
    // indicators, read receipts, etc.), which previously re-triggered this
    // effect constantly — revoking the blob URL out from under an
    // in-progress download and making it fail with a generic network error.
  }, [attachment.id, attachment.url, attachment.key, attachment.nonce, attachment.mimeType, attachment.localUrl]);

  if (failureReason) {
    const Icon = failureReason === "decrypt_failed" ? AlertTriangle : ImageIcon;
    return (
      <div className="mt-2 flex items-center gap-2 rounded-md border border-rose/30 bg-rose/5 px-3 py-2 text-xs text-rose">
        <Icon size={14} />
        <span>{attachmentFailureMessage(failureReason)}</span>
      </div>
    );
  }

  if (!url) {
    return (
      <div className="mt-2 flex items-center gap-2 rounded-md border border-border bg-surface px-3 py-2 text-xs text-text-muted">
        <Loader2 size={14} className="animate-spin" />
        <span>{attachment.filename}</span>
      </div>
    );
  }

  return (
    <figure className="mt-2 overflow-hidden rounded-md border border-border bg-surface">
      <img
        src={url}
        alt={attachment.filename}
        className="max-h-64 w-full object-contain"
      />
      <figcaption className="flex items-center justify-between gap-2 border-t border-border px-2 py-1 text-xs text-text-muted">
        <span className="truncate">{attachment.filename}</span>
        <a
          href={url}
          download={attachment.filename}
          title="Download attachment"
          className="flex-shrink-0 text-text-muted hover:text-cyan"
        >
          <Download size={14} />
        </a>
      </figcaption>
    </figure>
  );
}
