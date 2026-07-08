"use client";
import { useState } from "react";
import { StudioClient } from "./StudioClient";
import { StudioBatchClient } from "./batch/StudioBatchClient";

export function StudioTabs() {
  const [tab, setTab] = useState<"single" | "batch">("single");
  return (
    <div>
      <div className="mt-3 inline-flex rounded-lg border border-line p-1">
        <button
          type="button"
          onClick={() => setTab("single")}
          className={`min-h-[44px] sm:min-h-0 rounded-md px-3 py-1.5 text-sm ${tab === "single" ? "bg-raised text-ink shadow-raisededge" : "text-muted"}`}
        >
          Single
        </button>
        <button
          type="button"
          onClick={() => setTab("batch")}
          className={`min-h-[44px] sm:min-h-0 rounded-md px-3 py-1.5 text-sm ${tab === "batch" ? "bg-raised text-ink shadow-raisededge" : "text-muted"}`}
        >
          Batch
        </button>
      </div>
      <div className="mt-6">{tab === "single" ? <StudioClient /> : <StudioBatchClient />}</div>
    </div>
  );
}
