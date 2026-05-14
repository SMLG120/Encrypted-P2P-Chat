import type { Room } from "@/types/chat";
import type { User } from "@/types/auth";

interface ForwardMessageModalProps {
  rooms: Room[];
  currentRoomId: string;
  currentUser: User;
  onForward: (roomId: string) => void;
}

export function ForwardMessageModal({
  rooms,
  currentRoomId,
  currentUser,
  onForward,
}: ForwardMessageModalProps) {
  const targets = rooms.filter((room) => room.id !== currentRoomId);

  return (
    <div className="mt-1 max-h-80 overflow-y-auto">
      {targets.length === 0 ? (
        <p className="px-1 py-6 text-center text-sm text-text-muted">
          Start another conversation before forwarding.
        </p>
      ) : (
        targets.map((room) => (
          <button
            key={room.id}
            type="button"
            className="flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm text-text-secondary hover:bg-surface hover:text-text-primary"
            onClick={() => onForward(room.id)}
          >
            <span>{roomLabel(room, currentUser.id)}</span>
            <span className="font-mono text-xs text-text-muted">{room.type}</span>
          </button>
        ))
      )}
    </div>
  );
}

function roomLabel(room: Room, currentUserId: string): string {
  if (room.type === "group") return `${room.members.length} members`;
  const other = room.members.find((member) => member.user_id !== currentUserId);
  return other?.user?.display_name ?? "Direct conversation";
}
