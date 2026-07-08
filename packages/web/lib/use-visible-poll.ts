"use client";
import { useEffect } from "react";

/** Poll `fn` every `ms` while the tab is visible; fire immediately when it
 *  becomes visible again (phone unlock, app switch back). */
export function usePollWhileVisible(fn: () => void, ms: number, active: boolean): void {
  useEffect(() => {
    if (!active) return;
    fn();
    const id = setInterval(() => {
      if (document.visibilityState === "visible") fn();
    }, ms);
    const onVis = () => {
      if (document.visibilityState === "visible") fn();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [fn, ms, active]);
}
