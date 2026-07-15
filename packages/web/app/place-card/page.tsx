import { PlaceCardClient } from "./PlaceCardClient";

export const metadata = { title: "Make place cards" };

export default function Page() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Make place cards</h1>
      <p className="mt-2 text-muted">Turn a guest list into printable table place cards. Nothing leaves your browser.</p>
      <PlaceCardClient />
    </main>
  );
}
