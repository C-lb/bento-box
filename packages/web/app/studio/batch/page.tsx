import { StudioBatchClient } from "./StudioBatchClient";

export default function BatchPage() {
  return (
    <div>
      <p className="eyebrow">Headshot studio</p>
      <h1 className="mt-1 text-2xl font-semibold">Batch from a sheet</h1>
      <StudioBatchClient />
    </div>
  );
}
