import { TicketClient } from "./TicketClient";

export const metadata = { title: "Make event tickets" };

export default function Page() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Make event tickets</h1>
      <p className="mt-2 text-muted">Turn a list into event tickets with a QR code each. Nothing leaves your browser.</p>
      <TicketClient />
    </main>
  );
}
