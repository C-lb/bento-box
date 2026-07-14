"use client";
import { useState, type RefObject, type DragEvent, type MouseEvent } from "react";
import { Upload, X } from "lucide-react";

// A file field you can drag onto or click to browse. Shows the chosen file
// with a clear (X) so a selection can be undone without reopening the OS
// dialog. Wraps a real hidden <input> via inputRef, so callers keep reading
// inputRef.current.files exactly as before.
export function FileDrop({
  inputRef,
  accept,
  onChange,
  multiple = false,
  label = "Drop a file here, or click to browse",
}: {
  inputRef: RefObject<HTMLInputElement | null>;
  accept: string;
  onChange?: (hasFile: boolean) => void;
  multiple?: boolean;
  label?: string;
}) {
  const [name, setName] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  function sync() {
    const files = inputRef.current?.files;
    const n = files?.length ?? 0;
    setName(n === 0 ? null : n === 1 ? files![0].name : `${n} files`);
    onChange?.(n > 0);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files;
    if (!dropped || dropped.length === 0 || !inputRef.current) return;
    const dt = new DataTransfer();
    for (const f of multiple ? Array.from(dropped) : [dropped[0]]) dt.items.add(f);
    inputRef.current.files = dt.files;
    sync();
  }

  function clear(e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (inputRef.current) inputRef.current.value = "";
    setName(null);
    onChange?.(false);
  }

  return (
    <label
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={`flex w-full items-center gap-3 rounded-[14px] border border-dashed px-4 py-3 cursor-pointer transition-colors ${
        dragging ? "border-black/30 bg-black/[0.03]" : "border-black/15 hover:border-black/30"
      }`}
    >
      <input ref={inputRef} type="file" accept={accept} className="sr-only" onChange={sync} />
      {name ? (
        <>
          <span className="flex-1 truncate text-sm text-ink">{name}</span>
          <button type="button" onClick={clear} className="btn" aria-label="Remove file">
            <X className="w-4 h-4" strokeWidth={1.75} />
          </button>
        </>
      ) : (
        <>
          <Upload className="w-4 h-4 text-muted" strokeWidth={1.75} />
          <span className="text-sm text-muted">{label}</span>
        </>
      )}
    </label>
  );
}
