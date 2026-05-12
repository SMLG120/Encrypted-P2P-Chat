import { clsx } from "clsx";
import { Lock } from "lucide-react";
import { usePresenceStore } from "@/stores/presenceStore";
import type { Room } from "@/types/chat";
import type { User } from "@/types/auth";

interface ConversationListProps {
  rooms: Room[];
  activeRoomId: string | null;
  currentUser: User;
  onSelect: (roomId: string) => void;
}

export function ConversationList({ rooms, activeRoomId, currentUser, onSelect }: ConversationListProps) {
  const presence = usePresenceStore((s) => s.presence);

  if (!rooms.length) {
    return (
      <div className="flex flex-col items-center justify-center h-48 gap-2 px-4">
        <Lock size={20} className="text-text-muted" />
        <p className="text-xs text-text-muted text-center font-mono">
          No conversations yet.
          <br />Search for a user to start chatting.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-0.5 px-2">
      {rooms.map((room) => {
        const other = room.members.find((m) => m.user_id !== currentUser.id);
        const name =
          room.type === "direct"
            ? other?.user?.display_name ?? "Unknown"
            : `Group · ${room.members.length}`;
        const isOnline = other ? presence[other.user_id] === "online" : false;
        const isActive = room.id === activeRoomId;

        return (
          <button
            key={room.id}
            onClick={() => onSelect(room.id)}
            className={clsx(
              "flex items-center gap-3 w-full px-3 py-2.5 rounded-xl text-left transition-all duration-150",
              isActive
                ? "bg-cyan/10 border border-cyan/20 text-text-primary"
                : "hover:bg-panel text-text-secondary hover:text-text-primary border border-transparent"
            )}
          >
            {/* Avatar */}
            <div className="relative flex-shrink-0">
              <div
                className={clsx(
                  "w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold font-display",
                  isActive
                    ? "bg-cyan/20 text-cyan border border-cyan/30"
                    : "bg-border text-text-secondary border border-border"
                )}
              >
                {name[0]?.toUpperCase()}
              </div>
              {room.type === "direct" && (
                <span
                  className={clsx(
                    "absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-surface",
                    isOnline ? "bg-emerald" : "bg-text-muted"
                  )}
                />
              )}
            </div>

            {/* Name + encrypted badge */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-medium truncate">{name}</span>
                <Lock size={10} className={isActive ? "text-emerald flex-shrink-0" : "text-text-muted flex-shrink-0"} />
              </div>
              <p className="text-xs text-text-muted truncate font-mono">
                {isOnline ? "online" : "offline"}
              </p>
            </div>
          </button>
        );
      })}
    </div>
  );
}
