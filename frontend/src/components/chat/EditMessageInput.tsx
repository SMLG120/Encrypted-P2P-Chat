interface EditMessageInputProps {
  value: string;
  onChange: (value: string) => void;
  onCancel: () => void;
  onSave: () => void;
}

export function EditMessageInput({
  value,
  onChange,
  onCancel,
  onSave,
}: EditMessageInputProps) {
  return (
    <>
      <textarea
        autoFocus
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="input-field min-h-28 resize-none"
      />
      <div className="mt-3 flex justify-end gap-2">
        <button type="button" className="btn-ghost" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn-primary" onClick={onSave} disabled={!value.trim()}>
          Save
        </button>
      </div>
    </>
  );
}
