import { UserPlus, Users } from "lucide-react";
import { SecurityBadge, ConnectionStatus } from "@/components/security/SecurityBadge";
import { useUIStore } from "@/stores/presenceStore";
import type { Room } from "@/types/chat";

interface GroupChatHeaderProps {
  room: Room;
  onAddMember: () => void;
  onShowMembers: () => void;
}

export function GroupChatHeader({ room, onAddMember, onShowMembers }: GroupChatHeaderProps) {
  const connectionStatus = useUIStore((s) => s.connectionStatus);
  const displayName = room.name || "Group";

  return (
    <div className="flex items-center justify-between border-b border-border px-6 py-4 glass">
      <button
        type="button"
        onClick={onShowMembers}
        className="flex min-w-0 items-center gap-3 text-left"
      >
        <div className="flex h-9 w-9 items-center justify-center rounded-full border border-border-bright bg-cyan/10">
          <Users size={16} className="text-cyan" />
        </div>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-text-primary">{displayName}</p>
          <p className="text-xs text-text-muted">{room.members.length} members</p>
        </div>
      </button>

      <div className="flex items-center gap-3">
        <button
          type="button"
          title="Add member"
          onClick={onAddMember}
          className="flex h-8 w-8 items-center justify-center rounded-md border border-border text-text-muted hover:border-cyan/40 hover:text-cyan"
        >
          <UserPlus size={15} />
        </button>
        <ConnectionStatus status={connectionStatus} />
        <SecurityBadge size="sm" />
      </div>
    </div>
  );
}
