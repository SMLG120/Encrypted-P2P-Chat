import { useRef, useState } from "react";
import { AlertCircle, Clock, Forward, Lock } from "lucide-react";
import { clsx } from "clsx";
import { formatMessageTime } from "@/lib/date";
import { AttachmentPreview } from "@/components/chat/AttachmentPreview";
import { MessageActions } from "@/components/chat/MessageActions";
import { MessageStatus } from "@/components/chat/MessageStatus";
import { decodeMessageEnvelope } from "@/lib/messageEnvelope";
import type { Message } from "@/types/chat";

interface MessageBubbleProps {
  message: Message;
  isMine: boolean;
  senderName?: string;
  onEdit?: (message: Message) => void;
  onDelete?: (message: Message) => void;
  onForward?: (message: Message) => void;
  onResend?: (message: Message) => void;
}

export function MessageBubble({
  message,
  isMine,
  senderName,
  onEdit,
  onDelete,
  onForward,
  onResend,
}: MessageBubbleProps) {
  const [actionsPinned, setActionsPinned] = useState(false);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isDecrypted = message.decryptedText !== undefined;
  const failed = message.decryptionFailed;
  const envelope = decodeMessageEnvelope(message.decryptedText);
  const canEdit = isMine && isDecrypted && !message.is_deleted && message.delivery_status !== "failed";
  const canDelete = isMine && !message.is_deleted && message.delivery_status !== "failed";
  const canForward = isDecrypted && !message.is_deleted && message.delivery_status !== "failed";
  const canRetry = isMine && message.delivery_status === "failed";

  const copyMessage = () => {
    const value = envelope.text || message.decryptedText || "";
    if (value) void navigator.clipboard?.writeText(value);
    setActionsPinned(false);
  };

  const startLongPress = () => {
    longPressTimer.current = setTimeout(() => setActionsPinned(true), 350);
  };

  const cancelLongPress = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
  };

  return (
    <div className={clsx("flex flex-col gap-1 max-w-[72%]", isMine && "items-end self-end", !isMine && "items-start self-start")}>
      {!isMine && senderName && (
        <span className="text-xs text-text-muted font-mono px-1">{senderName}</span>
      )}
      <div
        tabIndex={0}
        onPointerDown={(event) => {
          if (event.pointerType !== "mouse") startLongPress();
        }}
        onPointerUp={cancelLongPress}
        onPointerCancel={cancelLongPress}
        onBlur={() => setActionsPinned(false)}
        className={clsx(
          "group relative px-4 py-2.5 rounded-2xl outline-none",
          isMine
            ? "bg-cyan/10 border border-cyan/20 text-text-primary rounded-br-sm"
            : "bg-panel border border-border text-text-primary rounded-bl-sm",
          failed && "border-rose/30 bg-rose/5"
        )}
      >
        {/* Encryption indicator */}
        <div className={clsx("absolute -top-1.5", isMine ? "-right-1" : "-left-1")}>
          <div
            title={isDecrypted ? "Decrypted successfully" : failed ? "Decryption failed" : "Encrypted"}
            className={clsx(
              "w-3 h-3 rounded-full flex items-center justify-center",
              isDecrypted && "bg-emerald/80",
              failed && "bg-rose/80",
              !isDecrypted && !failed && "bg-amber/60"
            )}
          >
            <Lock size={7} className="text-void" />
          </div>
        </div>

        {/* Content */}
        {message.is_deleted ? (
          <p className="text-sm italic text-text-muted">Message deleted</p>
        ) : isDecrypted ? (
          <>
            {envelope.forwarded && (
              <div className="mb-1 flex items-center gap-1 text-xs text-text-muted">
                <Forward size={11} />
                <span>Forwarded</span>
              </div>
            )}
            {envelope.text && (
              <p className="text-sm leading-relaxed break-words whitespace-pre-wrap">
                {envelope.text}
              </p>
            )}
            {envelope.attachments.map((attachment) => (
              <AttachmentPreview key={attachment.id} attachment={attachment} />
            ))}
          </>
        ) : failed ? (
          <div className="flex items-center gap-2 text-sm text-rose">
            <AlertCircle size={14} />
            <span className="font-mono text-xs">Decryption failed</span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-text-muted">
              {message.ciphertext.slice(0, 24)}…
            </span>
            <Clock size={12} className="text-text-muted animate-spin" />
          </div>
        )}

        <MessageActions
          align={isMine ? "right" : "left"}
          canEdit={canEdit}
          canDelete={canDelete}
          canForward={canForward}
          canRetry={canRetry}
          visible={actionsPinned}
          onEdit={() => {
            setActionsPinned(false);
            onEdit?.(message);
          }}
          onDelete={() => {
            setActionsPinned(false);
            onDelete?.(message);
          }}
          onForward={() => {
            setActionsPinned(false);
            onForward?.(message);
          }}
          onCopy={copyMessage}
          onRetry={() => {
            setActionsPinned(false);
            onResend?.(message);
          }}
        />
      </div>

      {/* Status row */}
      <div className={clsx("flex items-center gap-1.5 px-1", isMine && "flex-row-reverse")}>
        <span className="text-xs text-text-muted font-mono">
          {formatMessageTime(message.created_at)}
          {message.edited_at && !message.is_deleted ? " · edited" : ""}
        </span>
        {isMine && <MessageStatus status={message.delivery_status} />}
      </div>
    </div>
  );
}
