import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { requirementTooltip, settingsHref, type Readiness } from "@/components/tool-readiness";

// Amber "needs setup" badge shown on a blocked tool card. It is the only
// interactive element on a blocked card: clicking it deep-links to the exact
// Settings section that fixes the tool. Flat amber, dim ring — matches
// ConnectionPills; never a red/danger tone.
//
// The CardMenu owns the top-right (desktop) and centre-right (mobile) corners,
// so this badge stays clear of it: a full pill at the illustration's top-left
// on desktop, and a compact icon-only marker just left of the menu on the
// mobile row. Both link to the same Settings section.
export function RequirementBadge({ readiness }: { readiness: Readiness }) {
  const label = requirementTooltip(readiness);
  const href = settingsHref(readiness);
  return (
    <>
      {/* Desktop: full pill, top-left of the card (CardMenu sits top-right). */}
      <Link
        href={href}
        title={label}
        aria-label={label}
        className="absolute left-4 top-4 z-30 hidden items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700 ring-1 ring-amber-600/20 transition-colors hover:bg-amber-100 sm:inline-flex"
      >
        <TriangleAlert size={13} strokeWidth={2} aria-hidden />
        Setup needed
      </Link>

      {/* Mobile: icon-only marker, top-left over the icon tile corner. */}
      <Link
        href={href}
        title={label}
        aria-label={label}
        className="absolute left-2 top-2 z-30 inline-flex items-center justify-center rounded-full bg-amber-50 p-1 text-amber-700 ring-1 ring-amber-600/20 transition-colors hover:bg-amber-100 sm:hidden"
      >
        <TriangleAlert size={14} strokeWidth={2} aria-hidden />
      </Link>
    </>
  );
}
