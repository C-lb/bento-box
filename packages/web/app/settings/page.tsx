import { getConnections } from "@event-editor/core";

export default function Settings() {
  const connections = getConnections();
  return (
    <div>
      <p className="eyebrow">Settings</p>
      <h1 className="mt-1 text-2xl font-semibold">Connections</h1>
      <ul className="mt-8 space-y-3">
        {connections.map((c) => (
          <li key={c.id} className="card flex items-center justify-between">
            <span>{c.label}</span>
            <span className={c.configured ? "text-[#4ade80]" : "text-muted"}>
              {c.configured ? "Connected" : "Not configured"}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
