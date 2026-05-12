import { useState, useCallback } from "react";
import { Search, UserPlus, X } from "lucide-react";
import { roomService } from "@/services/roomService";
import { useRoomStore } from "@/stores/roomStore";

interface UserSearchProps {
  onClose: () => void;
  onRoomCreated: (roomId: string) => void;
}

export function UserSearch({ onClose, onRoomCreated }: UserSearchProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Array<{ id: string; username: string; display_name: string }>>([]);
  const [loading, setLoading] = useState(false);
  const addRoom = useRoomStore((s) => s.addRoom);

  const search = useCallback(async (q: string) => {
    if (q.length < 2) { setResults([]); return; }
    setLoading(true);
    try {
      const data = await roomService.searchUsers(q);
      setResults(data.users);
    } catch {
      setResults([]);
    } finally {
      setLoading(false);
    }
  }, []);

  const startChat = useCallback(async (userId: string) => {
    try {
      const room = await roomService.create("direct", [userId]);
      addRoom(room);
      onRoomCreated(room.id);
      onClose();
    } catch (e) {
      console.error(e);
    }
  }, [addRoom, onRoomCreated, onClose]);

  return (
    <div className="glass-bright rounded-2xl border border-border-bright shadow-panel overflow-hidden w-80">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <span className="text-sm font-display font-semibold text-text-primary">New Message</span>
        <button onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors">
          <X size={16} />
        </button>
      </div>

      {/* Search input */}
      <div className="relative px-4 py-3">
        <Search size={14} className="absolute left-7 top-1/2 -translate-y-1/2 text-text-muted" />
        <input
          autoFocus
          value={query}
          onChange={(e) => { setQuery(e.target.value); search(e.target.value); }}
          placeholder="Search by username…"
          className="w-full pl-8 pr-4 py-2 bg-surface border border-border rounded-lg
                     text-sm text-text-primary placeholder-text-muted font-mono
                     focus:outline-none focus:border-cyan transition-colors"
        />
      </div>

      {/* Results */}
      <div className="max-h-60 overflow-y-auto pb-2">
        {loading && (
          <div className="px-4 py-3 text-xs text-text-muted font-mono">Searching…</div>
        )}
        {!loading && results.map((user) => (
          <button
            key={user.id}
            onClick={() => startChat(user.id)}
            className="flex items-center gap-3 w-full px-4 py-2.5 hover:bg-panel transition-colors text-left"
          >
            <div className="w-8 h-8 rounded-full bg-cyan/10 border border-cyan/20 flex items-center justify-center">
              <span className="text-xs font-semibold text-cyan">
                {user.display_name[0]?.toUpperCase()}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-text-primary">{user.display_name}</p>
              <p className="text-xs text-text-muted font-mono">@{user.username}</p>
            </div>
            <UserPlus size={14} className="text-text-muted flex-shrink-0" />
          </button>
        ))}
        {!loading && query.length >= 2 && results.length === 0 && (
          <div className="px-4 py-3 text-xs text-text-muted font-mono">No users found.</div>
        )}
      </div>
    </div>
  );
}
