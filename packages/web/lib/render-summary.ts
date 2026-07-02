// Lightweight renderer for the formatted (LinkedIn / article) summaries.
// The model emits section headers as **bold** lines (and may still emit legacy
// Markdown "#" headers). We turn both into real bold text for on-screen preview
// and for rich-text clipboard copy, so nothing pastes out with literal "#".

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// **bold** -> <strong>. Runs on already-escaped text (the ** markers survive escaping).
function inlineBold(s: string): string {
  return s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

const HEADING_RE = /^\s*#{1,6}\s+(.*)$/; // "# Header" / "## Header" — note the required space, so "#AI" tags are left alone

export function summaryToHtml(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const heading = line.match(HEADING_RE);
      if (heading) {
        return `<p class="font-semibold text-ink mt-3 mb-1">${inlineBold(escapeHtml(heading[1]))}</p>`;
      }
      return `<p class="text-ink mb-2 last:mb-0">${inlineBold(escapeHtml(line))}</p>`;
    })
    .join("");
}

// Plain-text fallback for the clipboard: drop the "#" heading marks and the **
// bold markers, but leave "#AI"-style hashtags (no space) intact.
export function summaryToPlain(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => {
      const heading = line.match(HEADING_RE);
      const stripped = heading ? heading[1] : line;
      return stripped.replace(/\*\*(.+?)\*\*/g, "$1");
    })
    .join("\n");
}
