interface TypingIndicatorProps {
  usernames: string[];
}

export function TypingIndicator({ usernames }: TypingIndicatorProps) {
  if (!usernames.length) return null;
  const label =
    usernames.length === 1
      ? `${usernames[0]} is typing`
      : `${usernames.slice(0, 2).join(", ")} are typing`;

  return (
    <div className="flex items-center gap-2 px-4 py-2 text-xs text-text-muted font-mono">
      <span>{label}</span>
      <span className="flex gap-0.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="w-1 h-1 rounded-full bg-text-muted animate-bounce"
            style={{ animationDelay: `${i * 150}ms` }}
          />
        ))}
      </span>
    </div>
  );
}
