import type { ReactNode } from "react";
import { Copy, Forward, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { clsx } from "clsx";

interface MessageActionsProps {
  align: "left" | "right";
  canEdit: boolean;
  canDelete: boolean;
  canForward: boolean;
  canRetry: boolean;
  visible: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onForward: () => void;
  onCopy: () => void;
  onRetry: () => void;
}

export function MessageActions({
  align,
  canEdit,
  canDelete,
  canForward,
  canRetry,
  visible,
  onEdit,
  onDelete,
  onForward,
  onCopy,
  onRetry,
}: MessageActionsProps) {
  return (
    <div
      className={clsx(
        "absolute top-1 z-20 flex items-center gap-1 rounded-md border border-border bg-surface/95 p-1 shadow-panel transition-opacity",
        align === "right" ? "right-full mr-2" : "left-full ml-2",
        visible ? "opacity-100" : "opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto",
      )}
    >
      {canEdit && (
        <ActionButton title="Edit" onClick={onEdit}>
          <Pencil size={13} />
        </ActionButton>
      )}
      {canDelete && (
        <ActionButton title="Delete" onClick={onDelete}>
          <Trash2 size={13} />
        </ActionButton>
      )}
      {canForward && (
        <ActionButton title="Forward" onClick={onForward}>
          <Forward size={13} />
        </ActionButton>
      )}
      {canRetry && (
        <ActionButton title="Retry" onClick={onRetry}>
          <RotateCcw size={13} />
        </ActionButton>
      )}
      <ActionButton title="Copy" onClick={onCopy}>
        <Copy size={13} />
      </ActionButton>
    </div>
  );
}

function ActionButton({
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
      aria-label={title}
      title={title}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className="flex h-7 w-7 items-center justify-center rounded text-text-muted transition-colors hover:bg-border hover:text-cyan focus:outline-none focus:ring-1 focus:ring-cyan"
    >
      {children}
    </button>
  );
}
