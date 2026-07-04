import { QrClient } from "./QrClient";

export default function QrPage() {
  return (
    <div>
      <h1 className="text-2xl font-semibold">Make a QR code</h1>
      <QrClient />
    </div>
  );
}
