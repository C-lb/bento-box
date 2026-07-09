import { ShortenClient } from "./ShortenClient";

export default function ShortenPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold">Shorten a link</h1>
      <ShortenClient />
    </div>
  );
}
