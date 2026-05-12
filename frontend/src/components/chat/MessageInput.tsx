import { useState, useRef, useCallback } from "react";
import { Send, Lock } from "lucide-react";
import { clsx } from "clsx";

interface MessageInputProps {
  onSend: (text: string) => void;
  onTypingStart?: () => void;
  onTypingStop?: () => void;
  disabled?: boolean;
}

export function MessageInput({ onSend, onTypingStart, onTypingStop, disabled }: MessageInputProps) {
  const [text, setText] = useState("");
  const typingRef = useRef(false);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout>>();

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setText(e.target.value);
      if (!typingRef.current) {
        typingRef.current = true;
        onTypingStart?.();
      }
      clearTimeout(typingTimerRef.current);
      typingTimerRef.current = setTimeout(() => {
        typingRef.current = false;
        onTypingStop?.();
      }, 2000);
    },
    [onTypingStart, onTypingStop]
  );

  const handleSubmit = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setText("");
    clearTimeout(typingTimerRef.current);
    typingRef.current = false;
    onTypingStop?.();
  }, [text, disabled, onSend, onTypingStop]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit]
  );

  return (
    <div className="flex items-end gap-3 p-4 border-t border-border">
      {/* Security badge */}
      <div className="flex-shrink-0 pb-3">
        <span title="Messages are encrypted before sending">
          <Lock size={14} className="text-emerald" />
        </span>
      </div>

      <div className="flex-1 relative">
        <textarea
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          placeholder="Encrypted message…"
          rows={1}
          className={clsx(
            "w-full px-4 py-3 bg-surface border border-border rounded-xl resize-none",
            "text-text-primary placeholder-text-muted text-sm font-body",
            "focus:outline-none focus:border-cyan transition-colors duration-200",
            "max-h-32 overflow-y-auto",
            disabled && "opacity-50 cursor-not-allowed"
          )}
          style={{ lineHeight: "1.5" }}
        />
      </div>

      <button
        onClick={handleSubmit}
        disabled={!text.trim() || disabled}
        className={clsx(
          "flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center",
          "transition-all duration-200 mb-0.5",
          text.trim() && !disabled
            ? "bg-cyan text-void hover:shadow-cyan-glow active:scale-95"
            : "bg-surface text-text-muted border border-border cursor-not-allowed"
        )}
      >
        <Send size={16} />
      </button>
    </div>
  );
}
