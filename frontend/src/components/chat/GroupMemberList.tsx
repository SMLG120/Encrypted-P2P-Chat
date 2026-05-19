import { LogOut, UserMinus } from "lucide-react";
import type { Room } from "@/types/chat";
import type { User } from "@/types/auth";

interface GroupMemberListProps {
  room: Room;
  currentUser: User;
  onRemoveMember: (userId: string) => void;
  onLeaveGroup: () => void;
}

export function GroupMemberList({
  room,
  currentUser,
  onRemoveMember,
  onLeaveGroup,
}: GroupMemberListProps) {
  const currentMembership = room.members.find((member) => member.user_id === currentUser.id);
  const isOwner = currentMembership?.role === "owner";

  return (
    <div className="w-72 rounded-lg border border-border bg-panel p-3 shadow-panel">
      <div className="mb-2 text-xs font-semibold uppercase text-text-muted">
        Members
      </div>
      <div className="max-h-72 overflow-y-auto">
        {room.members.map((member) => {
          const user = member.user;
          const isSelf = member.user_id === currentUser.id;
          return (
            <div key={member.user_id} className="flex items-center gap-3 py-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-surface text-xs text-cyan">
                {(user?.display_name ?? "?")[0]?.toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-text-primary">
                  {user?.display_name ?? "Unknown"}
                </p>
                <p className="truncate text-xs text-text-muted">
                  {member.role}{isSelf ? " · you" : ""}
                </p>
              </div>
              {isOwner && !isSelf && (
                <button
                  type="button"
                  title="Remove member"
                  onClick={() => onRemoveMember(member.user_id)}
                  className="text-text-muted hover:text-rose"
                >
                  <UserMinus size={15} />
                </button>
              )}
            </div>
          );
        })}
      </div>
      <button
        type="button"
        onClick={onLeaveGroup}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-md border border-rose/30 px-3 py-2 text-sm text-rose hover:bg-rose/10"
      >
        <LogOut size={14} />
        Leave group
      </button>
    </div>
  );
}
