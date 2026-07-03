export function navShouldAnimate(prev: string | null, next: string): boolean {
  return prev !== null && prev !== next;
}

export function bestMatchIndex(hrefs: string[], path: string): number {
  let idx = -1;
  let best = -1;
  hrefs.forEach((href, i) => {
    const match = href === "/" ? path === "/" : path === href || path.startsWith(href + "/");
    if (match && href.length > best) {
      best = href.length;
      idx = i;
    }
  });
  return idx;
}
