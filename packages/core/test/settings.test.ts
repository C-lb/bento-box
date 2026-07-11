import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getConnections, upsertEnvKeys, readEnvValues, ENV_KEYS } from "../src/settings.js";

function tmpEnv() {
  return join(tmpdir(), `ee-env-${Math.random().toString(36).slice(2)}.env`);
}

describe("getConnections", () => {
  it("reports unconfigured when env empty", () => {
    const conns = getConnections({});
    expect(conns.map((c) => c.id).sort()).toEqual(["anthropic", "canva", "google", "groq"]);
    expect(conns.every((c) => c.configured === false)).toBe(true);
  });

  it("reports google configured when its vars present", () => {
    const conns = getConnections({
      GOOGLE_CLIENT_ID: "x",
      GOOGLE_CLIENT_SECRET: "y",
    });
    expect(conns.find((c) => c.id === "google")?.configured).toBe(true);
    expect(conns.find((c) => c.id === "anthropic")?.configured).toBe(false);
  });

  it("reports groq configured when its key present", () => {
    const conns = getConnections({ GROQ_API_KEY: "k" });
    expect(conns.find((c) => c.id === "groq")?.configured).toBe(true);
  });
});

describe("ENV_KEYS", () => {
  it("lists exactly the six settable keys", () => {
    expect([...ENV_KEYS].sort()).toEqual(
      [
        "ANTHROPIC_API_KEY",
        "CANVA_CLIENT_ID",
        "CANVA_CLIENT_SECRET",
        "GOOGLE_CLIENT_ID",
        "GOOGLE_CLIENT_SECRET",
        "GROQ_API_KEY",
      ].sort(),
    );
  });
});

describe("upsertEnvKeys", () => {
  it("creates the file with given keys when it does not exist", () => {
    const f = tmpEnv();
    try {
      upsertEnvKeys(f, { ANTHROPIC_API_KEY: "sk-1", GROQ_API_KEY: "gk-1" });
      const out = readFileSync(f, "utf8");
      expect(out).toMatch(/^ANTHROPIC_API_KEY=sk-1$/m);
      expect(out).toMatch(/^GROQ_API_KEY=gk-1$/m);
    } finally {
      rmSync(f, { force: true });
    }
  });

  it("updates an existing key in place and preserves comments + other lines", () => {
    const f = tmpEnv();
    writeFileSync(f, "# my keys\nANTHROPIC_API_KEY=old\nGOOGLE_CLIENT_ID=gid\n");
    try {
      upsertEnvKeys(f, { ANTHROPIC_API_KEY: "new" });
      const out = readFileSync(f, "utf8");
      expect(out).toContain("# my keys");
      expect(out).toMatch(/^ANTHROPIC_API_KEY=new$/m);
      expect(out).toMatch(/^GOOGLE_CLIENT_ID=gid$/m);
      expect(out).not.toContain("ANTHROPIC_API_KEY=old");
    } finally {
      rmSync(f, { force: true });
    }
  });

  it("appends keys not already present", () => {
    const f = tmpEnv();
    writeFileSync(f, "ANTHROPIC_API_KEY=a\n");
    try {
      upsertEnvKeys(f, { GROQ_API_KEY: "g" });
      const out = readFileSync(f, "utf8");
      expect(out).toMatch(/^ANTHROPIC_API_KEY=a$/m);
      expect(out).toMatch(/^GROQ_API_KEY=g$/m);
    } finally {
      rmSync(f, { force: true });
    }
  });

  it("skips blank/undefined values so existing keys are kept", () => {
    const f = tmpEnv();
    writeFileSync(f, "ANTHROPIC_API_KEY=keep\n");
    try {
      upsertEnvKeys(f, { ANTHROPIC_API_KEY: "", GROQ_API_KEY: "  ", CANVA_CLIENT_ID: undefined });
      const out = readFileSync(f, "utf8");
      expect(out).toMatch(/^ANTHROPIC_API_KEY=keep$/m);
      expect(out).not.toMatch(/^GROQ_API_KEY=/m);
      expect(out).not.toMatch(/^CANVA_CLIENT_ID=/m);
    } finally {
      rmSync(f, { force: true });
    }
  });

  it("ignores keys outside the allowed set", () => {
    const f = tmpEnv();
    try {
      // @ts-expect-error - PATH is not a settable key
      upsertEnvKeys(f, { PATH: "/evil", ANTHROPIC_API_KEY: "ok" });
      const out = existsSync(f) ? readFileSync(f, "utf8") : "";
      expect(out).not.toContain("PATH=/evil");
      expect(out).toMatch(/^ANTHROPIC_API_KEY=ok$/m);
    } finally {
      rmSync(f, { force: true });
    }
  });

  it("trims surrounding whitespace from values", () => {
    const f = tmpEnv();
    try {
      upsertEnvKeys(f, { ANTHROPIC_API_KEY: "  sk-trim  " });
      expect(readFileSync(f, "utf8")).toMatch(/^ANTHROPIC_API_KEY=sk-trim$/m);
    } finally {
      rmSync(f, { force: true });
    }
  });
});

describe("readEnvValues", () => {
  it("returns {} for a missing file", () => {
    expect(readEnvValues(tmpEnv(), ["GROQ_API_KEY"])).toEqual({});
  });

  it("reads only requested keys, skipping comments and malformed lines", () => {
    const f = tmpEnv();
    writeFileSync(
      f,
      "# comment\nGROQ_API_KEY=gsk_123\nnot a pair\nANTHROPIC_API_KEY=sk-ant-9\nOTHER=x\n"
    );
    try {
      expect(readEnvValues(f, ["GROQ_API_KEY", "ANTHROPIC_API_KEY"])).toEqual({
        GROQ_API_KEY: "gsk_123",
        ANTHROPIC_API_KEY: "sk-ant-9",
      });
    } finally {
      rmSync(f, { force: true });
    }
  });

  it("strips surrounding quotes and skips blank values", () => {
    const f = tmpEnv();
    writeFileSync(f, 'GROQ_API_KEY="gsk_q"\nANTHROPIC_API_KEY=\nEE_UNLOCK_CODE=\'shh\'\n');
    try {
      expect(readEnvValues(f, ["GROQ_API_KEY", "ANTHROPIC_API_KEY", "EE_UNLOCK_CODE"])).toEqual({
        GROQ_API_KEY: "gsk_q",
        EE_UNLOCK_CODE: "shh",
      });
    } finally {
      rmSync(f, { force: true });
    }
  });
});
