import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { requirementTooltip, settingsHref, type Readiness } from "@/components/tool-readiness";

// Amber "needs setup" badge shown on a blocked tool card. It is the only
// interactive element on a blocked card: clicking it deep-links to the exact
// Settings section that fixes the tool. Flat amber, dim ring — matches
// ConnectionPills; never a red/danger tone.
export function RequirementBadge({ readiness }: { readiness: Readiness }) {
  const label = requirementTooltip(readiness);
  return (
    <Link
      href={settingsHref(readiness)}
      title={label}
      aria-label={label}
      className="absolute right-3 top-3 z-10 inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700 ring-1 ring-amber-600/20 transition-colors hover:bg-amber-100"
    >
      <TriangleAlert size={13} strokeWidth={2} aria-hidden />
      Setup needed
    </Link>
  );
}
