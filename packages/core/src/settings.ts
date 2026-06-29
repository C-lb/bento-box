export type ConnectionId = "google" | "anthropic" | "canva" | "groq";

export interface Connection {
  id: ConnectionId;
  label: string;
  configured: boolean;
}

type Env = Record<string, string | undefined>;

const REQUIRED: Record<ConnectionId, { label: string; vars: string[] }> = {
  google: { label: "Google Drive", vars: ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET"] },
  anthropic: { label: "Claude (Anthropic)", vars: ["ANTHROPIC_API_KEY"] },
  canva: { label: "Canva", vars: ["CANVA_CLIENT_ID", "CANVA_CLIENT_SECRET"] },
  groq: { label: "Groq (transcription)", vars: ["GROQ_API_KEY"] },
};

export function getConnections(env: Env = process.env): Connection[] {
  return (Object.keys(REQUIRED) as ConnectionId[]).map((id) => ({
    id,
    label: REQUIRED[id].label,
    configured: REQUIRED[id].vars.every((v) => !!env[v] && env[v]!.trim() !== ""),
  }));
}
