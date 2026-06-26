import Link from "next/link";

export function ToolCard({ href, eyebrow, title, body }: {
  href: string; eyebrow: string; title: string; body: string;
}) {
  return (
    <Link href={href} className="card block transition-colors hover:border-muted/40">
      <p className="eyebrow">{eyebrow}</p>
      <h2 className="mt-1 text-lg font-medium">{title}</h2>
      <p className="mt-2 text-muted">{body}</p>
    </Link>
  );
}
