import { Loader2, CheckCircle2, AlertCircle, Circle, type LucideIcon } from "lucide-react";
import type { Tone } from "@/lib/status";

const TONE: Record<Tone, { color: string; Icon: LucideIcon; spin?: boolean }> = {
  idle: { color: "text-muted", Icon: Circle },
  active: { color: "text-accent", Icon: Loader2, spin: true },
  success: { color: "text-success", Icon: CheckCircle2 },
  error: { color: "text-danger", Icon: AlertCircle },
};

export function StatusBadge({ tone, label }: { tone: Tone; label: string }) {
  const { color, Icon, spin } = TONE[tone];
  return (
    <span className={`inline-flex items-center gap-2 ${color}`}>
      <Icon size={16} strokeWidth={1.75} aria-hidden className={spin ? "animate-spin" : ""} />
      <span className="text-sm font-medium">{label}</span>
    </span>
  );
}
