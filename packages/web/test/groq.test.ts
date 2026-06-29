import { describe, it, expect, vi, afterEach } from "vitest";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFile } from "node:fs/promises";

const { transcribeChunk, TRANSCRIBE_MODEL } = await import("../lib/groq.js");

afterEach(() => vi.restoreAllMocks());

async function fixture(): Promise<string> {
  const p = join(tmpdir(), `ee-groq-${Math.random().toString(36).slice(2)}.mp3`);
  await writeFile(p, Buffer.from([0x49, 0x44, 0x33]));
  return p;
}

describe("transcribeChunk", () => {
  it("posts to Groq and maps verbose_json segments", async () => {
    process.env.GROQ_API_KEY = "k";
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ segments: [{ start: 0, text: " hi " }, { start: 3, text: "there" }] }), {
        status: 200,
      }),
    );
    const out = await transcribeChunk(await fixture());
    expect(out.segments).toEqual([{ start: 0, text: " hi " }, { start: 3, text: "there" }]);
    const url = fetchMock.mock.calls[0][0];
    expect(String(url)).toContain("/audio/transcriptions");
  });

  it("throws with .status on a non-ok response (so backoff can see 429)", async () => {
    process.env.GROQ_API_KEY = "k";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("rate", { status: 429 }));
    await expect(transcribeChunk(await fixture())).rejects.toMatchObject({ status: 429 });
  });

  it("defaults the model to a whisper variant", () => {
    expect(TRANSCRIBE_MODEL).toContain("whisper");
  });
});
