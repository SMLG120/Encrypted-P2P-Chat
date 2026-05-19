import { useCallback, useState } from "react";
import { Search, UserPlus, X } from "lucide-react";
import { toast } from "sonner";

import { roomService } from "@/services/roomService";
import { useAuthStore } from "@/stores/authStore";
import type { Room } from "@/types/chat";

interface AddMemberModalProps {
  room: Room;
  onClose: () => void;
  onMemberAdded: (room: Room) => void;
}

export function AddMemberModal({ room, onClose, onMemberAdded }: AddMemberModalProps) {
  const currentUser = useAuthStore((s) => s.user);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Array<{ id: string; username: string; display_name: string }>>([]);
  const [loading, setLoading] = useState(false);

  const search = useCallback(
    async (value: string) => {
      if (value.length < 2) {
        setResults([]);
        return;
      }
      setLoading(true);
      try {
        const memberIds = new Set(room.members.map((member) => member.user_id));
        const data = await roomService.searchUsers(value);
        setResults(
          data.users.filter(
            (user) => user.id !== currentUser?.id && !memberIds.has(user.id),
          ),
        );
      } catch (error) {
        setResults([]);
        toast.error(error instanceof Error ? error.message : "Could not search users");
      } finally {
        setLoading(false);
      }
    },
    [currentUser?.id, room.members],
  );

  const addMember = useCallback(
    async (userId: string) => {
      try {
        await roomService.addGroupMember(room.id, userId);
        onMemberAdded(await roomService.get(room.id));
        onClose();
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not add member");
      }
    },
    [onClose, onMemberAdded, room.id],
  );

  return (
    <div className="w-80 overflow-hidden rounded-lg border border-border-bright bg-panel shadow-panel">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
          <UserPlus size={15} className="text-cyan" />
          <span>Add Member</span>
        </div>
        <button type="button" title="Close" onClick={onClose} className="text-text-muted hover:text-text-primary">
          <X size={16} />
        </button>
      </div>

      <div className="p-4">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              void search(event.target.value);
            }}
            placeholder="Search users"
            className="w-full rounded-md border border-border bg-surface py-2 pl-8 pr-3 text-sm text-text-primary placeholder-text-muted focus:border-cyan focus:outline-none"
          />
        </div>

        <div className="mt-3 max-h-56 overflow-y-auto">
          {loading && <div className="py-3 text-xs text-text-muted">Searching...</div>}
          {!loading &&
            results.map((user) => (
              <button
                key={user.id}
                type="button"
                onClick={() => addMember(user.id)}
                className="flex w-full items-center gap-3 px-1 py-2 text-left hover:bg-surface"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-surface text-xs text-cyan">
                  {user.display_name[0]?.toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-text-primary">{user.display_name}</p>
                  <p className="truncate text-xs text-text-muted">@{user.username}</p>
                </div>
                <UserPlus size={14} className="text-text-muted" />
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}
