import type { Headshot } from "@event-editor/core/types";

// Shared serializer so the list route and the single-row route never drift.
export function toHeadshotDto(r: Headshot) {
  const imageUrl = r.status === "done" ? `/api/studio/image/${r.id}` : null;
  return {
    id: r.id,
    status: r.status,
    templateId: r.templateId,
    nameText: r.nameText,
    titleText: r.titleText,
    errorMessage: r.errorMessage,
    imageUrl,
    createdAt: r.createdAt,
    renderer: r.renderer,
    source: r.source,
    downloadUrl: r.status === "done" ? (r.renderer === "canva" ? r.exportUrl : imageUrl) : null,
  };
}
