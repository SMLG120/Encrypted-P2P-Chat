import { useEffect, useState } from "react";
import { ImageIcon, Loader2 } from "lucide-react";

import { decryptAttachmentBlob } from "@/lib/attachmentCrypto";
import type { ClientAttachmentRef } from "@/lib/messageEnvelope";

interface AttachmentPreviewProps {
  attachment: ClientAttachmentRef;
}

export function AttachmentPreview({ attachment }: AttachmentPreviewProps) {
  const [url, setUrl] = useState(attachment.localUrl ?? "");
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (attachment.localUrl) {
      setUrl(attachment.localUrl);
      return;
    }

    let objectUrl = "";
    let cancelled = false;

    async function load() {
      try {
        const response = await fetch(attachment.url, { credentials: "include" });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const encryptedBlob = await response.blob();
        const blob = await decryptAttachmentBlob(
          encryptedBlob,
          attachment.key,
          attachment.nonce,
          attachment.mimeType
        );
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) setUrl(objectUrl);
      } catch {
        if (!cancelled) setFailed(true);
      }
    }

    load();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [attachment]);

  if (failed) {
    return (
      <div className="mt-2 flex items-center gap-2 rounded-md border border-rose/30 bg-rose/5 px-3 py-2 text-xs text-rose">
        <ImageIcon size={14} />
        <span>Attachment unavailable</span>
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
      <figcaption className="border-t border-border px-2 py-1 text-xs text-text-muted">
        {attachment.filename}
      </figcaption>
    </figure>
  );
}
