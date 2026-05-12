import { SecurityBadge, ConnectionStatus } from "@/components/security/SecurityBadge";
import { usePresenceStore } from "@/stores/presenceStore";
import { useUIStore } from "@/stores/presenceStore";
import type { Room } from "@/types/chat";
import type { User } from "@/types/auth";

interface ChatHeaderProps {
  room: Room;
  currentUser: User;
}

export function ChatHeader({ room, currentUser }: ChatHeaderProps) {
  const presence = usePresenceStore((s) => s.presence);
  const connectionStatus = useUIStore((s) => s.connectionStatus);

  const otherMembers = room.members.filter((m) => m.user_id !== currentUser.id);
  const displayName =
    room.type === "direct"
      ? otherMembers[0]?.user?.display_name ?? "Unknown"
      : `Group · ${room.members.length} members`;

  const otherUser = otherMembers[0];
  const isOnline = otherUser ? presence[otherUser.user_id] === "online" : false;

  return (
    <div className="flex items-center justify-between px-6 py-4 border-b border-border glass">
      {/* Left: avatar + name */}
      <div className="flex items-center gap-3">
        <div className="relative">
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-cyan/30 to-emerald/30 border border-border-bright flex items-center justify-center">
            <span className="text-sm font-display font-semibold text-cyan">
              {displayName[0]?.toUpperCase()}
            </span>
          </div>
          {room.type === "direct" && (
            <span
              className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-surface
              ${isOnline ? "bg-emerald" : "bg-text-muted"}`}
            />
          )}
        </div>
        <div>
          <p className="text-sm font-display font-medium text-text-primary">{displayName}</p>
          <p className="text-xs text-text-muted font-mono">
            {room.type === "direct"
              ? isOnline
                ? "online"
                : "offline"
              : `${room.members.length} members`}
          </p>
        </div>
      </div>

      {/* Right: status indicators */}
      <div className="flex items-center gap-3">
        <ConnectionStatus status={connectionStatus} />
        <SecurityBadge size="sm" />
      </div>
    </div>
  );
}
