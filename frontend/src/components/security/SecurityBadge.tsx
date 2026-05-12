import { Lock } from "lucide-react";
import { clsx } from "clsx";

interface SecurityBadgeProps {
  size?: "sm" | "md";
  className?: string;
}

export function SecurityBadge({ size = "sm", className }: SecurityBadgeProps) {
  return (
    <div
      className={clsx(
        "flex items-center gap-1.5 rounded-full font-mono font-medium",
        "bg-emerald/10 text-emerald border border-emerald/20",
        size === "sm" && "px-2.5 py-1 text-xs",
        size === "md" && "px-3 py-1.5 text-sm",
        className
      )}
    >
      <Lock size={size === "sm" ? 10 : 12} className="flex-shrink-0" />
      <span>E2EE</span>
    </div>
  );
}

interface ConnectionStatusProps {
  status: "p2p" | "relay" | "offline";
}

export function ConnectionStatus({ status }: ConnectionStatusProps) {
  const config = {
    p2p: { label: "P2P Direct", color: "text-emerald", dotColor: "bg-emerald", title: "WebRTC peer-to-peer connection" },
    relay: { label: "Relay", color: "text-amber", dotColor: "bg-amber", title: "Encrypted server relay" },
    offline: { label: "Offline", color: "text-text-muted", dotColor: "bg-text-muted", title: "Disconnected" },
  }[status];

  return (
    <div
      title={config.title}
      className="flex items-center gap-1.5 font-mono text-xs cursor-help"
    >
      <span className={clsx("w-1.5 h-1.5 rounded-full", config.dotColor, status !== "offline" && "animate-pulse")} />
      <span className={config.color}>{config.label}</span>
    </div>
  );
}
