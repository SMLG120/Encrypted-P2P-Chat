import { useState, useRef, useCallback } from "react";
import { ImagePlus, Loader2, Send, Lock, X } from "lucide-react";
import { clsx } from "clsx";

interface MessageInputProps {
  onSend: (text: string, files: File[]) => Promise<void> | void;
  onTypingStart?: () => void;
  onTypingStop?: () => void;
  disabled?: boolean;
  busy?: boolean;
}

export function MessageInput({ onSend, onTypingStart, onTypingStop, disabled, busy }: MessageInputProps) {
  const [text, setText] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const typingRef = useRef(false);
  const typingTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleSubmit = useCallback(async () => {
    const trimmed = text.trim();
    if ((!trimmed && files.length === 0) || disabled || busy) return;
    await onSend(trimmed, files);
    setText("");
    setFiles([]);
    clearTimeout(typingTimerRef.current);
    typingRef.current = false;
    onTypingStop?.();
  }, [text, files, disabled, busy, onSend, onTypingStop]);

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
    <div className="border-t border-border p-4">
      {files.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-2 pl-8">
          {files.map((file) => (
            <div key={`${file.name}:${file.size}`} className="flex items-center gap-2 rounded-md border border-border bg-surface px-2 py-1 text-xs text-text-secondary">
              <span className="max-w-40 truncate">{file.name}</span>
              <button
                type="button"
                title="Remove attachment"
                onClick={() => setFiles((current) => current.filter((item) => item !== file))}
                className="text-text-muted hover:text-rose"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-end gap-3">
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
          disabled={disabled || busy}
          placeholder="Encrypted message…"
          rows={1}
          className={clsx(
            "w-full px-4 py-3 bg-surface border border-border rounded-xl resize-none",
            "text-text-primary placeholder-text-muted text-sm font-body",
            "focus:outline-none focus:border-cyan transition-colors duration-200",
            "max-h-32 overflow-y-auto",
            (disabled || busy) && "opacity-50 cursor-not-allowed"
          )}
          style={{ lineHeight: "1.5" }}
        />
      </div>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        multiple
        className="hidden"
        onChange={(event) => {
          const selected = Array.from(event.target.files ?? []);
          setFiles((current) => [...current, ...selected].slice(0, 10));
          event.target.value = "";
        }}
      />

      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={disabled || busy}
        title="Upload image or GIF"
        className="mb-0.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-border bg-surface text-text-muted transition-colors hover:border-border-bright hover:text-cyan disabled:cursor-not-allowed disabled:opacity-50"
      >
        <ImagePlus size={16} />
      </button>

      <button
        onClick={handleSubmit}
        disabled={(!text.trim() && files.length === 0) || disabled || busy}
        className={clsx(
          "flex-shrink-0 w-10 h-10 rounded-xl flex items-center justify-center",
          "transition-all duration-200 mb-0.5",
          (text.trim() || files.length > 0) && !disabled && !busy
            ? "bg-cyan text-void hover:shadow-cyan-glow active:scale-95"
            : "bg-surface text-text-muted border border-border cursor-not-allowed"
        )}
      >
        {busy ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
      </button>
      </div>
    </div>
  );
}
