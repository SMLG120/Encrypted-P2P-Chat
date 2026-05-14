import type { ReactNode } from "react";
import {
  AlertCircle,
  Check,
  CheckCheck,
  Clock,
  Forward,
  Lock,
  MoreHorizontal,
  Pencil,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { clsx } from "clsx";
import { formatMessageTime } from "@/lib/date";
import { AttachmentPreview } from "@/components/chat/AttachmentPreview";
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
  const isDecrypted = message.decryptedText !== undefined;
  const failed = message.decryptionFailed;
  const envelope = decodeMessageEnvelope(message.decryptedText);
  const canEdit = isMine && isDecrypted && !message.is_deleted && message.delivery_status !== "failed";
  const canDelete = isMine && !message.is_deleted && message.delivery_status !== "failed";
  const canForward = isDecrypted && !message.is_deleted && message.delivery_status !== "failed";

  return (
    <div className={clsx("flex flex-col gap-1 max-w-[72%]", isMine && "items-end self-end", !isMine && "items-start self-start")}>
      {!isMine && senderName && (
        <span className="text-xs text-text-muted font-mono px-1">{senderName}</span>
      )}
      <div
        className={clsx(
          "group relative px-4 py-2.5 rounded-2xl",
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

        <div
          className={clsx(
            "absolute top-1 hidden items-center gap-1 rounded-md border border-border bg-surface/95 p-1 shadow-panel group-hover:flex",
            isMine ? "right-full mr-2" : "left-full ml-2"
          )}
        >
          {canEdit && (
            <IconButton title="Edit" onClick={() => onEdit?.(message)}>
              <Pencil size={13} />
            </IconButton>
          )}
          {canDelete && (
            <IconButton title="Delete" onClick={() => onDelete?.(message)}>
              <Trash2 size={13} />
            </IconButton>
          )}
          {canForward && (
            <IconButton title="Forward" onClick={() => onForward?.(message)}>
              <Forward size={13} />
            </IconButton>
          )}
          {isMine && message.delivery_status === "failed" && (
            <IconButton title="Resend" onClick={() => onResend?.(message)}>
              <RotateCcw size={13} />
            </IconButton>
          )}
          {!canEdit && !canDelete && !canForward && message.delivery_status !== "failed" && (
            <MoreHorizontal size={13} className="text-text-muted" />
          )}
        </div>
      </div>

      {/* Status row */}
      <div className={clsx("flex items-center gap-1.5 px-1", isMine && "flex-row-reverse")}>
        <span className="text-xs text-text-muted font-mono">
          {formatMessageTime(message.created_at)}
          {message.edited_at && !message.is_deleted ? " · edited" : ""}
        </span>
        {isMine && <DeliveryIcon status={message.delivery_status} />}
      </div>
    </div>
  );
}

function IconButton({
  title,
  onClick,
  children,
}: {
  title: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className="flex h-6 w-6 items-center justify-center rounded text-text-muted transition-colors hover:bg-border hover:text-cyan"
    >
      {children}
    </button>
  );
}

function DeliveryIcon({ status }: { status: Message["delivery_status"] }) {
  if (status === "sending") return <Clock size={12} className="text-text-muted" />;
  if (status === "failed") return <AlertCircle size={12} className="text-rose" />;
  if (status === "read") return <CheckCheck size={12} className="text-cyan" />;
  if (status === "delivered") return <CheckCheck size={12} className="text-text-muted" />;
  return <Check size={12} className="text-text-muted" />;
}
