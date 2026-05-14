interface DeleteMessageDialogProps {
  onCancel: () => void;
  onConfirm: () => void;
}

export function DeleteMessageDialog({ onCancel, onConfirm }: DeleteMessageDialogProps) {
  return (
    <div className="w-full max-w-sm rounded-lg border border-border bg-panel p-4 shadow-panel">
      <h2 className="font-display text-base font-semibold text-text-primary">Delete message</h2>
      <p className="mt-2 text-sm text-text-secondary">
        This will replace the encrypted payload with a tombstone for everyone in the conversation.
      </p>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn-primary bg-rose hover:bg-rose/90" onClick={onConfirm}>
          Delete
        </button>
      </div>
    </div>
  );
}
