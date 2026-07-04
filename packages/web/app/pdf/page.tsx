import { PdfClient } from "./PdfClient";

export default function PdfPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold">Merge, split, or shrink PDFs</h1>
      <PdfClient />
    </div>
  );
}
