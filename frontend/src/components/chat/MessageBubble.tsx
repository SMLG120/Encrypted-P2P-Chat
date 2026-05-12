import { Check, CheckCheck, Clock, AlertCircle, Lock } from "lucide-react";
import { clsx } from "clsx";
import { formatMessageTime } from "@/lib/date";
import type { Message } from "@/types/chat";

interface MessageBubbleProps {
  message: Message;
  isMine: boolean;
  senderName?: string;
}

export function MessageBubble({ message, isMine, senderName }: MessageBubbleProps) {
  const isDecrypted = message.decryptedText !== undefined;
  const failed = message.decryptionFailed;

  return (
    <div className={clsx("flex flex-col gap-1 max-w-[72%]", isMine && "items-end self-end", !isMine && "items-start self-start")}>
      {!isMine && senderName && (
        <span className="text-xs text-text-muted font-mono px-1">{senderName}</span>
      )}
      <div
        className={clsx(
          "relative px-4 py-2.5 rounded-2xl",
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
        {isDecrypted ? (
          <p className="text-sm leading-relaxed break-words whitespace-pre-wrap">
            {message.decryptedText}
          </p>
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
      </div>

      {/* Status row */}
      <div className={clsx("flex items-center gap-1.5 px-1", isMine && "flex-row-reverse")}>
        <span className="text-xs text-text-muted font-mono">
          {formatMessageTime(message.created_at)}
        </span>
        {isMine && <DeliveryIcon status={message.delivery_status} />}
      </div>
    </div>
  );
}

function DeliveryIcon({ status }: { status: Message["delivery_status"] }) {
  if (status === "sending") return <Clock size={12} className="text-text-muted" />;
  if (status === "failed") return <AlertCircle size={12} className="text-rose" />;
  if (status === "read") return <CheckCheck size={12} className="text-cyan" />;
  if (status === "delivered") return <CheckCheck size={12} className="text-text-muted" />;
  return <Check size={12} className="text-text-muted" />;
}
