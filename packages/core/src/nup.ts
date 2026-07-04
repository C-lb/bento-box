import type { PageSize } from "./merge.js";

export interface Placement { x: number; y: number }
export interface Grid { cols: number; rows: number; placements: Placement[] }

export function nUpGrid(page: PageSize, cell: PageSize, gap: number): Grid {
  const cols = Math.max(1, Math.floor((page.width + gap) / (cell.width + gap)));
  const rows = Math.max(1, Math.floor((page.height + gap) / (cell.height + gap)));
  const blockW = cols * cell.width + (cols - 1) * gap;
  const blockH = rows * cell.height + (rows - 1) * gap;
  const startX = (page.width - blockW) / 2;
  const startY = (page.height - blockH) / 2;
  const placements: Placement[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = startX + c * (cell.width + gap);
      // top row first: row 0 sits at the top of the block (highest y)
      const y = startY + blockH - (r + 1) * cell.height - r * gap;
      placements.push({ x, y });
    }
  }
  return { cols, rows, placements };
}
