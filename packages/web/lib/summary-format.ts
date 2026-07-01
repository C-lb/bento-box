export type SummaryFormat = "linkedin" | "article";

export function pickCachedSummary(
  row: { summaryLinkedin: string | null; summaryArticle: string | null },
  format: SummaryFormat,
): string | null {
  return format === "linkedin" ? row.summaryLinkedin : row.summaryArticle;
}
