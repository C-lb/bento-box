import { CertificateClient } from "./CertificateClient";

export const metadata = { title: "Make certificates" };

export default function Page() {
  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <h1 className="text-2xl font-semibold tracking-tight">Make certificates</h1>
      <p className="mt-2 text-muted">
        Turn a list of names into personalised certificates. Nothing leaves your browser.
      </p>
      <CertificateClient />
    </main>
  );
}
