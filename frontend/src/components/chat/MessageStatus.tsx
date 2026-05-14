import { AlertCircle, Check, CheckCheck, Clock } from "lucide-react";
import type { Message } from "@/types/chat";

export function MessageStatus({ status }: { status: Message["delivery_status"] }) {
  if (status === "sending") return <Clock size={12} className="text-text-muted" />;
  if (status === "failed") return <AlertCircle size={12} className="text-rose" />;
  if (status === "read") return <CheckCheck size={12} className="text-cyan" />;
  if (status === "delivered") return <CheckCheck size={12} className="text-text-muted" />;
  return <Check size={12} className="text-text-muted" />;
}
