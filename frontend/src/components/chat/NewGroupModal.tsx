import { useCallback, useState } from "react";
import { Plus, Search, Users, X } from "lucide-react";
import { toast } from "sonner";

import { roomService } from "@/services/roomService";
import { useAuthStore } from "@/stores/authStore";
import { useRoomStore } from "@/stores/roomStore";

interface NewGroupModalProps {
  onClose: () => void;
  onRoomCreated: (roomId: string) => void;
}

interface SearchUser {
  id: string;
  username: string;
  display_name: string;
}

export function NewGroupModal({ onClose, onRoomCreated }: NewGroupModalProps) {
  const currentUser = useAuthStore((s) => s.user);
  const addRoom = useRoomStore((s) => s.addRoom);
  const [name, setName] = useState("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchUser[]>([]);
  const [selected, setSelected] = useState<SearchUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);

  const search = useCallback(
    async (value: string) => {
      if (value.length < 2) {
        setResults([]);
        return;
      }
      setLoading(true);
      try {
        const data = await roomService.searchUsers(value);
        const selectedIds = new Set(selected.map((user) => user.id));
        setResults(
          data.users.filter(
            (user) => user.id !== currentUser?.id && !selectedIds.has(user.id),
          ),
        );
      } catch (error) {
        setResults([]);
        toast.error(error instanceof Error ? error.message : "Could not search users");
      } finally {
        setLoading(false);
      }
    },
    [currentUser?.id, selected],
  );

  const createGroup = useCallback(async () => {
    if (!name.trim()) {
      toast.error("Group name is required");
      return;
    }
    if (selected.length === 0) {
      toast.error("Add at least one member");
      return;
    }
    setCreating(true);
    try {
      const room = await roomService.createGroupRoom(
        name.trim(),
        selected.map((user) => user.id),
      );
      addRoom(room);
      onRoomCreated(room.id);
      onClose();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create group");
    } finally {
      setCreating(false);
    }
  }, [addRoom, name, onClose, onRoomCreated, selected]);

  return (
    <div className="w-96 overflow-hidden rounded-lg border border-border-bright bg-panel shadow-panel">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-text-primary">
          <Users size={15} className="text-cyan" />
          <span>New Group</span>
        </div>
        <button type="button" title="Close" onClick={onClose} className="text-text-muted hover:text-text-primary">
          <X size={16} />
        </button>
      </div>

      <div className="space-y-3 p-4">
        <input
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Group name"
          className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder-text-muted focus:border-cyan focus:outline-none"
        />

        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              void search(event.target.value);
            }}
            placeholder="Add members"
            className="w-full rounded-md border border-border bg-surface py-2 pl-8 pr-3 text-sm text-text-primary placeholder-text-muted focus:border-cyan focus:outline-none"
          />
        </div>

        {selected.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {selected.map((user) => (
              <button
                key={user.id}
                type="button"
                onClick={() => setSelected((items) => items.filter((item) => item.id !== user.id))}
                className="rounded-md border border-cyan/20 bg-cyan/10 px-2 py-1 text-xs text-cyan"
              >
                {user.display_name}
              </button>
            ))}
          </div>
        )}

        <div className="max-h-48 overflow-y-auto">
          {loading && <div className="py-3 text-xs text-text-muted">Searching...</div>}
          {!loading &&
            results.map((user) => (
              <button
                key={user.id}
                type="button"
                onClick={() => {
                  setSelected((items) => [...items, user]);
                  setQuery("");
                  setResults([]);
                }}
                className="flex w-full items-center gap-3 px-1 py-2 text-left hover:bg-surface"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full border border-border bg-surface text-xs text-cyan">
                  {user.display_name[0]?.toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-text-primary">{user.display_name}</p>
                  <p className="truncate text-xs text-text-muted">@{user.username}</p>
                </div>
                <Plus size={14} className="text-text-muted" />
              </button>
            ))}
        </div>

        <button
          type="button"
          onClick={createGroup}
          disabled={creating}
          className="flex w-full items-center justify-center rounded-md bg-cyan px-3 py-2 text-sm font-semibold text-void hover:bg-cyan/90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Create group
        </button>
      </div>
    </div>
  );
}
