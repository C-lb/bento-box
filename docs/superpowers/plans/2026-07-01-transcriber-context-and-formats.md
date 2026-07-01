# Transcriber Context File + Multi-Format Summaries Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the audio transcriber accept an optional context file (md/html/pdf/pptx) to ground summaries, extract editable event details, and offer General/LinkedIn/Article summary formats generated on demand.

**Architecture:** Pure prompt builders and the `EventDetails` type live in `@event-editor/core` (`transcribe.ts` + a `summary-examples.ts` constants module), unit-tested. Context-file parsing, the Anthropic structured-output extraction, the on-demand format generation, and all routes live in `@event-editor/web`. The done-state UI splits into `EventDetailsPanel` and `SummaryFormats` components plus small `Segmented`/`CopyButton` primitives.

**Tech Stack:** Next.js 16 (App Router, Node runtime), better-sqlite3 + Drizzle, `@anthropic-ai/sdk` 0.69 (`output_config` structured output), `officeparser` (new, pdf/pptx to text), vitest.

## Global Constraints

- Web imports core via SUBPATH exports only (e.g. `@event-editor/core/transcribe`), never the barrel — the barrel pulls native better-sqlite3.
- Turbopack does NOT remap `.js`→`.ts` on resolved relative VALUE imports: use EXTENSIONLESS relative value imports (`./audio` not `./audio.js`); `import type ... from "./x.js"` is fine.
- `CREATE TABLE IF NOT EXISTS` silently no-ops on an existing table, so NEW columns must be added with the existing guarded `addColumnIfMissing(db, table, column, ddlType)` in `runMigrations`, AND mirrored into the CREATE DDL for fresh DBs.
- Re-migrate the dev DB with the ROOT `npm run migrate` (sets `EE_DB_PATH=$PWD/data/app.db`). The `-w @event-editor/core run migrate` form targets the WRONG file.
- Anthropic structured output uses `output_config: { format: { type: "json_schema", schema } }` and the `as any` cast (SDK 0.69 types lag), per `scorePhoto`. Check `res.stop_reason === "refusal"`.
- Copy rule: no em dashes anywhere in code, prompts, or UI copy. Sentence-case eyebrows, never ALL-CAPS. Anti-vibecode house styles apply to all UI.
- `core` build must run before web sees changes: `npm -w @event-editor/core run build` (root `predev`/`build` already chain it).
- Model env: `EE_SUMMARY_MODEL` (default `claude-opus-4-8`) for summaries; reuse `SUMMARY_MODEL` from `web/lib/anthropic.ts`.

---

### Task 1: Schema and migration for the new transcription columns

**Files:**
- Modify: `packages/core/src/schema/index.ts:67-80` (transcriptions table)
- Modify: `packages/core/src/migrate.ts` (transcriptions CREATE DDL + `runMigrations`)
- Test: `packages/core/test/migrate-columns.test.ts` (create)

**Interfaces:**
- Produces: the `transcriptions` table gains nullable columns `context_file_path TEXT`, `context_text TEXT`, `event_details TEXT`, `summary_linkedin TEXT`, `summary_article TEXT`. Drizzle fields: `contextFilePath`, `contextText`, `eventDetails`, `summaryLinkedin`, `summaryArticle`.

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/migrate-columns.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { sql } from "drizzle-orm";
import { runMigrations } from "../src/migrate.js";

describe("transcriptions migration columns", () => {
  it("adds context and format columns", () => {
    const db = drizzle(new Database(":memory:"));
    runMigrations(db as any);
    const cols = (db.all(sql.raw("PRAGMA table_info(transcriptions)")) as Array<{ name: string }>).map((r) => r.name);
    for (const c of ["context_file_path", "context_text", "event_details", "summary_linkedin", "summary_article"]) {
      expect(cols).toContain(c);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w @event-editor/core exec -- vitest run test/migrate-columns.test.ts`
Expected: FAIL (columns missing).

- [ ] **Step 3: Add the Drizzle columns**

In `packages/core/src/schema/index.ts`, inside the `transcriptions` table, after `updatedAt`:

```ts
  contextFilePath: text("context_file_path"),
  contextText: text("context_text"),
  eventDetails: text("event_details"),
  summaryLinkedin: text("summary_linkedin"),
  summaryArticle: text("summary_article"),
```

- [ ] **Step 4: Mirror into the CREATE DDL and add guarded ALTERs**

In `packages/core/src/migrate.ts`, add these lines to the `transcriptions` CREATE block before the closing `)` (after `updated_at ...`):

```sql
    ,context_file_path TEXT,
    context_text TEXT,
    event_details TEXT,
    summary_linkedin TEXT,
    summary_article TEXT
```

Then in `runMigrations`, after the existing `addColumnIfMissing(db, "headshots", "batch_id", "TEXT");` line:

```ts
  addColumnIfMissing(db, "transcriptions", "context_file_path", "TEXT");
  addColumnIfMissing(db, "transcriptions", "context_text", "TEXT");
  addColumnIfMissing(db, "transcriptions", "event_details", "TEXT");
  addColumnIfMissing(db, "transcriptions", "summary_linkedin", "TEXT");
  addColumnIfMissing(db, "transcriptions", "summary_article", "TEXT");
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm -w @event-editor/core exec -- vitest run test/migrate-columns.test.ts`
Expected: PASS.

- [ ] **Step 6: Re-migrate the dev DB and rebuild core**

Run: `npm -w @event-editor/core run build && npm run migrate`
Expected: prints `migrated .../data/app.db` with no error.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/schema/index.ts packages/core/src/migrate.ts packages/core/test/migrate-columns.test.ts
git commit -m "feat(core): transcription context + format summary columns"
```

---

### Task 2: EventDetails type and extraction prompt builder

**Files:**
- Modify: `packages/core/src/transcribe.ts` (add type + builder near `buildSummaryPrompt`)
- Test: `packages/core/test/transcribe.test.ts` (extend)

**Interfaces:**
- Produces:
  - `export interface EventDetails { eventName: string; eventDescription: string; speakers: { name: string; company: string }[]; sponsors: { name: string; company: string }[]; }`
  - `export function buildEventDetailsPrompt(contextText: string, transcript: string): { role: "user"; content: string }[]`

- [ ] **Step 1: Write the failing test**

Append to `packages/core/test/transcribe.test.ts` (and add `buildEventDetailsPrompt` to the import list at the top):

```ts
describe("buildEventDetailsPrompt", () => {
  it("includes context and transcript and asks for speakers and sponsors", () => {
    const msgs = buildEventDetailsPrompt("AGENDA TEXT", "TRANSCRIPT TEXT");
    const text = msgs[0].content;
    expect(msgs[0].role).toBe("user");
    expect(text).toContain("AGENDA TEXT");
    expect(text).toContain("TRANSCRIPT TEXT");
    expect(text.toLowerCase()).toContain("speakers");
    expect(text.toLowerCase()).toContain("sponsors");
  });
  it("labels the context as possibly empty without breaking", () => {
    const msgs = buildEventDetailsPrompt("", "ONLY TRANSCRIPT");
    expect(msgs[0].content).toContain("ONLY TRANSCRIPT");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w @event-editor/core exec -- vitest run test/transcribe.test.ts -t buildEventDetailsPrompt`
Expected: FAIL (`buildEventDetailsPrompt` not exported).

- [ ] **Step 3: Implement the type and builder**

In `packages/core/src/transcribe.ts`, after `buildSummaryPrompt`:

```ts
export interface EventDetails {
  eventName: string;
  eventDescription: string;
  speakers: { name: string; company: string }[];
  sponsors: { name: string; company: string }[];
}

export function buildEventDetailsPrompt(
  contextText: string,
  transcript: string,
): { role: "user"; content: string }[] {
  const context = contextText.trim() || "(no context document was provided)";
  return [
    {
      role: "user",
      content:
        "You extract factual event details from a supporting document and a transcript. " +
        "Return the event name, a one or two sentence event description, the speakers, and the " +
        "sponsors or partners, with each person's or sponsor's company. Prefer the supporting " +
        "document for correct spelling of names and companies; fall back to the transcript. " +
        "If a value is unknown, use an empty string or an empty list. Do not invent names. " +
        "Do not use em dashes.\n\n" +
        "Supporting document:\n" + context + "\n\n" +
        "Transcript:\n" + transcript,
    },
  ];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm -w @event-editor/core exec -- vitest run test/transcribe.test.ts -t buildEventDetailsPrompt`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/transcribe.ts packages/core/test/transcribe.test.ts
git commit -m "feat(core): EventDetails type and extraction prompt"
```

---

### Task 3: LinkedIn and Article prompt builders with style examples

**Files:**
- Create: `packages/core/src/summary-examples.ts`
- Modify: `packages/core/src/transcribe.ts` (import examples, add two builders)
- Test: `packages/core/test/transcribe.test.ts` (extend)

**Interfaces:**
- Consumes: `EventDetails` (Task 2).
- Produces:
  - `export function buildLinkedInPrompt(transcript: string, details: EventDetails): { role: "user"; content: string }[]`
  - `export function buildArticlePrompt(transcript: string, details: EventDetails): { role: "user"; content: string }[]`

- [ ] **Step 1: Write the failing test**

Append to `packages/core/test/transcribe.test.ts` (add both builders to the import list):

```ts
const DETAILS = {
  eventName: "SPARK Luncheon",
  eventDescription: "A closed door session on AI.",
  speakers: [{ name: "Tom Leighton", company: "Akamai" }],
  sponsors: [{ name: "Akamai Technologies", company: "" }],
};

describe("buildLinkedInPrompt", () => {
  it("encodes the required structure and grounding", () => {
    const text = buildLinkedInPrompt("TRANSCRIPT", DETAILS)[0].content;
    expect(text).toContain("Key takeaways from the session:");
    expect(text).toContain("Our sincere thanks to");
    expect(text.toLowerCase()).toContain("hashtag");
    expect(text.toLowerCase()).toContain("no sign-off");
    expect(text).toContain("em dashes");
    expect(text).toContain("Tom Leighton");
    expect(text).toContain("Akamai Technologies");
    expect(text).toContain("TRANSCRIPT");
  });
});

describe("buildArticlePrompt", () => {
  it("caps length and asks for SEO structure and takeaways", () => {
    const text = buildArticlePrompt("TRANSCRIPT", DETAILS)[0].content;
    expect(text).toContain("1000 words");
    expect(text.toLowerCase()).toContain("seo");
    expect(text.toLowerCase()).toContain("key takeaways");
    expect(text).toContain("TRANSCRIPT");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w @event-editor/core exec -- vitest run test/transcribe.test.ts -t Prompt`
Expected: FAIL (builders not exported).

- [ ] **Step 3: Create the examples module**

Create `packages/core/src/summary-examples.ts` (real reference posts supplied by the user; two LinkedIn and one article are enough for style and keep token cost down):

```ts
// Style reference posts. Used verbatim as few-shot examples in the LinkedIn and
// Article prompt builders. Content supplied by the user.

export const LINKEDIN_EXAMPLES: string[] = [
  `As AI moves from experimentation into real-time, distributed and agentic deployment, one message is clear: the future of AI will not be defined by capability alone, but by the infrastructure, security and trust required to scale it with confidence.

At the recent SPARK luncheon, held in partnership with Akamai Technologies, senior leaders gathered for a closed-door conversation on "Building Tomorrow: Powering the AI Era with Distributed Intelligence."

The session featured Dr. Tom Leighton, CEO and Co-Founder of Akamai, who shared his perspectives on how AI is reshaping the internet, enterprise security, digital experiences and the distributed infrastructure needed for the next era.

Key takeaways from the session:
• Distributed intelligence is becoming critical as AI moves closer to users, data and devices
• Latency, resilience and cost are now strategic architecture considerations
• Sovereign AI will require infrastructure that supports local context, data control and trusted delivery
• AI is expanding the attack surface, from shadow AI and prompt risks to agent traffic and larger bot armies
• Security must be engineered into AI systems from the start, with microsegmentation, zero trust, runtime controls and stronger observability

Our sincere thanks to Dr. Tom Leighton for sharing his insights and perspectives, and to Akamai Technologies for their partnership and support in making this important conversation possible.

hashtag#AI hashtag#DistributedIntelligence hashtag#EnterpriseAI hashtag#AIGovernance hashtag#Cybersecurity hashtag#ZeroTrust hashtag#SovereignAI hashtag#DigitalInfrastructure hashtag#AgenticAI hashtag#SingaporeTech`,
  `As organisations move from AI experimentation into enterprise-wide deployment, one message is becoming increasingly clear: the future of AI will not be defined by capability alone, but by trust.

At the recent SPARK Leaders' Circle, held in partnership with Veeam Software, senior leaders came together for a private dinner to explore trusted AI deployment, resilient governance, and future-ready transformation.

The evening also marked the official launch of SafeAI.sg, Singapore's first industry-led Centre of Excellence focused on AI governance, operational resilience, and enterprise-grade safety.

Key takeaways from the evening:
• AI governance must move beyond policy documents into operational controls
• Trust, resilience, and accountability are becoming foundational parts of the AI stack
• Organisations must prepare for the risks introduced by agentic AI and autonomous decision-making
• Data governance, observability, and security must evolve alongside AI adoption

Our sincere thanks to Kelly Forbes, Cheri L., Luis Carlos Cruz Huertas, Stanley Tsang, and Glen Francis for sharing their insights and perspectives during the evening.

We would also like to thank Veeam for their partnership and support in making this important conversation possible.

hashtag#SafeAI hashtag#TrustedAI hashtag#ResponsibleAI hashtag#AIGovernance hashtag#AIResilience hashtag#EnterpriseAI hashtag#CyberResilience hashtag#DigitalTrust hashtag#AgenticAI hashtag#SingaporeTech`,
];

export const ARTICLE_EXAMPLES: string[] = [
  `SPARK was honoured to partner with IMDA on an executive workshop focused on how organisations can move from AI experimentation to production-ready deployment.

The discussion brought together enterprise, government, and technology leaders to examine the key enablers of AI at scale, from governance frameworks and runtime validation to low-latency infrastructure, external observability, narrative intelligence, and the growing shift toward agentic systems.

Key takeaways:
- AI governance must extend across the full lifecycle, from data and models to runtime controls and production approval gates.
- Low-latency, high-availability infrastructure is critical for real-world deployment.
- External observability is becoming increasingly important for detecting trust, reputational, and adversarial risks early.
- Successful adoption depends not just on technology, but also on change management, internal champions, and clear business use cases.
- Organisations need stronger alignment between AI ambition, operating models, and the underlying data architecture required to support scale.`,
];
```

- [ ] **Step 4: Implement the two builders**

In `packages/core/src/transcribe.ts`, add the import at the top:

```ts
import { LINKEDIN_EXAMPLES, ARTICLE_EXAMPLES } from "./summary-examples.js";
```

Then after `buildEventDetailsPrompt`:

```ts
function detailsBlock(details: EventDetails): string {
  const speakers = details.speakers.map((s) => s.company ? `${s.name} (${s.company})` : s.name).join(", ") || "(none provided)";
  const sponsors = details.sponsors.map((s) => s.company ? `${s.name} (${s.company})` : s.name).join(", ") || "(none provided)";
  return (
    `Event name: ${details.eventName || "(unknown)"}\n` +
    `Event description: ${details.eventDescription || "(unknown)"}\n` +
    `Speakers: ${speakers}\n` +
    `Sponsors and partners: ${sponsors}`
  );
}

export function buildLinkedInPrompt(
  transcript: string,
  details: EventDetails,
): { role: "user"; content: string }[] {
  const examples = LINKEDIN_EXAMPLES.map((e, i) => `Example ${i + 1}:\n${e}`).join("\n\n---\n\n");
  return [
    {
      role: "user",
      content:
        "Write a LinkedIn post recapping this event, in the style of the examples below.\n\n" +
        "Structure, exactly:\n" +
        "1. Two to four short paragraphs, each two to three lines, opening on what the session was about.\n" +
        "2. A line reading exactly: Key takeaways from the session:\n" +
        "3. Bullet pointers (use the bullet character) drawn from what the key speakers said.\n" +
        "4. A line starting: Our sincere thanks to ... naming the speakers for sharing their insights, " +
        "and separately thanking the sponsors and partners for their support.\n" +
        "5. A final line of topic hashtags. Write each hashtag as hashtag#Topic (the literal word " +
        "hashtag followed by #), matching the examples.\n\n" +
        "Rules: no sign-off, no closing salutation, no author name at the end. No em dashes. " +
        "Only thank people and sponsors named in the details below; do not invent names.\n\n" +
        "Event details:\n" + detailsBlock(details) + "\n\n" +
        "Transcript:\n" + transcript + "\n\n" +
        "Style examples:\n" + examples,
    },
  ];
}

export function buildArticlePrompt(
  transcript: string,
  details: EventDetails,
): { role: "user"; content: string }[] {
  const examples = ARTICLE_EXAMPLES.map((e, i) => `Example ${i + 1}:\n${e}`).join("\n\n---\n\n");
  return [
    {
      role: "user",
      content:
        "Write an article recapping this event, in the style of the examples below.\n\n" +
        "Requirements: at most 1000 words. Follow SEO best practices: a clear title, descriptive " +
        "section headers, and natural use of the event's key topics as keywords. Include a clear " +
        "key takeaways treatment (a short list or a dedicated section). No em dashes. Only reference " +
        "people and sponsors named in the details below; do not invent names.\n\n" +
        "Event details:\n" + detailsBlock(details) + "\n\n" +
        "Transcript:\n" + transcript + "\n\n" +
        "Style examples:\n" + examples,
    },
  ];
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm -w @event-editor/core exec -- vitest run test/transcribe.test.ts -t Prompt`
Expected: PASS.

- [ ] **Step 6: Rebuild core and commit**

```bash
npm -w @event-editor/core run build
git add packages/core/src/summary-examples.ts packages/core/src/transcribe.ts packages/core/test/transcribe.test.ts
git commit -m "feat(core): LinkedIn and Article summary prompt builders"
```

---

### Task 4: Context file parser (web)

**Files:**
- Modify: `packages/web/package.json` (add `officeparser`)
- Create: `packages/web/lib/context.ts`
- Test: `packages/web/test/context.test.ts` (create)

**Interfaces:**
- Produces:
  - `export type ContextExt = "md" | "markdown" | "html" | "pdf" | "pptx"`
  - `export function extFromName(filename: string): ContextExt | null`
  - `export function stripMarkup(input: string): string` (pure; md + html to plain text)
  - `export async function parseContextFile(buffer: Buffer, ext: ContextExt): Promise<string>`

- [ ] **Step 1: Add the dependency**

Run: `npm -w @event-editor/web install officeparser@^5.1.1`
Expected: installs, `officeparser` appears in `packages/web/package.json` dependencies.

- [ ] **Step 2: Write the failing test**

Create `packages/web/test/context.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { extFromName, stripMarkup, parseContextFile } from "../lib/context";

describe("extFromName", () => {
  it("maps known extensions and rejects others", () => {
    expect(extFromName("agenda.PDF")).toBe("pdf");
    expect(extFromName("deck.pptx")).toBe("pptx");
    expect(extFromName("notes.md")).toBe("md");
    expect(extFromName("page.html")).toBe("html");
    expect(extFromName("audio.mp3")).toBeNull();
    expect(extFromName("noext")).toBeNull();
  });
});

describe("stripMarkup", () => {
  it("removes html tags, scripts, and decodes entities", () => {
    const out = stripMarkup("<style>x{}</style><h1>Hi &amp; bye</h1><p>Line</p>");
    expect(out).toContain("Hi & bye");
    expect(out).toContain("Line");
    expect(out).not.toContain("<h1>");
    expect(out).not.toContain("x{}");
  });
  it("strips common markdown markers", () => {
    const out = stripMarkup("# Title\n**bold** and _em_ and `code`");
    expect(out).toContain("Title");
    expect(out).toContain("bold");
    expect(out).not.toContain("**");
    expect(out).not.toContain("`");
  });
});

describe("parseContextFile", () => {
  it("parses md and html in-house", async () => {
    expect(await parseContextFile(Buffer.from("# Hello"), "md")).toContain("Hello");
    expect(await parseContextFile(Buffer.from("<p>Hello</p>"), "html")).toContain("Hello");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm -w @event-editor/web exec -- vitest run test/context.test.ts`
Expected: FAIL (`../lib/context` missing).

- [ ] **Step 4: Implement the parser**

Create `packages/web/lib/context.ts`:

```ts
import { parseOfficeAsync } from "officeparser";

export type ContextExt = "md" | "markdown" | "html" | "pdf" | "pptx";

const EXTS: ContextExt[] = ["md", "markdown", "html", "pdf", "pptx"];

export function extFromName(filename: string): ContextExt | null {
  const dot = filename.lastIndexOf(".");
  if (dot < 0) return null;
  const ext = filename.slice(dot + 1).toLowerCase();
  return (EXTS as string[]).includes(ext) ? (ext as ContextExt) : null;
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&nbsp;": " ",
};

export function stripMarkup(input: string): string {
  let s = input.replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ");
  s = s.replace(/<[^>]+>/g, " ");
  s = s.replace(/&#?\w+;/g, (m) => ENTITIES[m] ?? " ");
  // Markdown markers: headings, emphasis, inline code, list bullets.
  s = s.replace(/^#{1,6}\s+/gm, "");
  s = s.replace(/(\*\*|__|\*|_|`)/g, "");
  s = s.replace(/^\s*[-*+]\s+/gm, "");
  s = s.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n");
  return s.trim();
}

export async function parseContextFile(buffer: Buffer, ext: ContextExt): Promise<string> {
  if (ext === "md" || ext === "markdown" || ext === "html") {
    return stripMarkup(buffer.toString("utf8"));
  }
  // pdf, pptx: officeparser returns extracted plain text.
  const text = await parseOfficeAsync(buffer);
  return stripMarkup(text);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm -w @event-editor/web exec -- vitest run test/context.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/web/package.json package-lock.json packages/web/lib/context.ts packages/web/test/context.test.ts
git commit -m "feat(web): context file parser for md/html/pdf/pptx"
```

---

### Task 5: Stash helpers and Anthropic extraction, wired into the pipeline

**Files:**
- Modify: `packages/web/lib/context.ts` (stash helpers)
- Modify: `packages/web/lib/anthropic.ts` (add `extractEventDetails`, `generateFormattedSummary`)
- Modify: `packages/core/src/transcription.ts` (extend `TranscriptionDeps`, add extraction step)
- Modify: `packages/web/lib/transcriber.ts` (pass `extractDetails` dep)
- Test: `packages/web/test/context.test.ts` (extend), `packages/core/test/transcription.test.ts` (extend), `packages/web/test/anthropic-summary.test.ts` (create)

**Interfaces:**
- Consumes: `parseContextFile`, `extFromName` (Task 4); `EventDetails`, `buildEventDetailsPrompt`, `buildLinkedInPrompt`, `buildArticlePrompt` (Tasks 2-3); `SUMMARY_MODEL`, `visionClient` (existing).
- Produces:
  - `export async function stashContext(buffer: Buffer, ext: ContextExt): Promise<string>` (returns contextId)
  - `export async function readStash(contextId: string): Promise<{ ext: ContextExt; text: string } | null>`
  - web `export async function extractEventDetails(client: Anthropic, contextText: string, transcript: string): Promise<EventDetails>`
  - web `export async function generateFormattedSummary(client: Anthropic, format: "linkedin" | "article", transcript: string, details: EventDetails): Promise<string>`
  - core `TranscriptionDeps` gains `extractDetails(contextText: string, transcript: string): Promise<EventDetails>`; `runTranscription` stores `eventDetails` JSON.

- [ ] **Step 1: Write the failing tests**

Append to `packages/web/test/context.test.ts`:

```ts
import { stashContext, readStash } from "../lib/context";

describe("stash round-trip", () => {
  it("stashes parsed text and reads it back", async () => {
    const id = await stashContext(Buffer.from("# Kept"), "md");
    const got = await readStash(id);
    expect(got?.ext).toBe("md");
    expect(got?.text).toContain("Kept");
  });
  it("returns null for an unknown id", async () => {
    expect(await readStash("does-not-exist")).toBeNull();
  });
});
```

Create `packages/web/test/anthropic-summary.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { extractEventDetails, generateFormattedSummary } from "../lib/anthropic";

const details = { eventName: "E", eventDescription: "D", speakers: [], sponsors: [] };

describe("extractEventDetails", () => {
  it("parses structured JSON from the model", async () => {
    const client = { messages: { create: vi.fn(async () => ({ content: [{ type: "text", text: JSON.stringify(details) }] })) } } as any;
    const out = await extractEventDetails(client, "ctx", "tx");
    expect(out.eventName).toBe("E");
    expect(Array.isArray(out.speakers)).toBe(true);
  });
});

describe("generateFormattedSummary", () => {
  it("returns the model text for a format", async () => {
    const client = { messages: { create: vi.fn(async () => ({ content: [{ type: "text", text: "POST BODY" }] })) } } as any;
    const out = await generateFormattedSummary(client, "linkedin", "tx", details);
    expect(out).toBe("POST BODY");
  });
});
```

In `packages/core/test/transcription.test.ts`, `extractDetails` becomes a REQUIRED dep, so the existing `happyDeps` object (and any other deps objects, e.g. the error-path test) MUST gain it or those tests break. Add to `happyDeps`:

```ts
  extractDetails: async () => ({ eventName: "Demo Event", eventDescription: "", speakers: [], sponsors: [] }),
```

Then add a new assertion in the happy-path test that the JSON is stored:

```ts
    const done = db.select().from(transcriptions).where(eq(transcriptions.id, id)).all()[0];
    expect(JSON.parse(done.eventDetails as string).eventName).toBe("Demo Event");
```

(Reuse whatever `db`, `id`, `transcriptions`, and `eq` bindings the existing test already sets up; do not introduce new imports if they are already present.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm -w @event-editor/web exec -- vitest run test/context.test.ts test/anthropic-summary.test.ts`
Expected: FAIL (functions missing).

- [ ] **Step 3: Implement stash helpers**

Append to `packages/web/lib/context.ts`:

```ts
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const STASH_DIR = resolve("data/uploads/context");

export async function stashContext(buffer: Buffer, ext: ContextExt): Promise<string> {
  const id = randomUUID();
  await mkdir(STASH_DIR, { recursive: true });
  const text = await parseContextFile(buffer, ext);
  await writeFile(resolve(STASH_DIR, `${id}.json`), JSON.stringify({ ext, text }), "utf8");
  return id;
}

export async function readStash(contextId: string): Promise<{ ext: ContextExt; text: string } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(contextId)) return null;
  try {
    const raw = await readFile(resolve(STASH_DIR, `${contextId}.json`), "utf8");
    const obj = JSON.parse(raw);
    return { ext: obj.ext, text: obj.text };
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Implement the Anthropic functions**

In `packages/web/lib/anthropic.ts`, add imports:

```ts
import { buildEventDetailsPrompt, buildLinkedInPrompt, buildArticlePrompt, type EventDetails } from "@event-editor/core/transcribe";
```

Add a schema constant near `SCORE_SCHEMA`:

```ts
const DETAILS_SCHEMA = {
  type: "object",
  properties: {
    eventName: { type: "string" },
    eventDescription: { type: "string" },
    speakers: { type: "array", items: { type: "object", properties: { name: { type: "string" }, company: { type: "string" } }, required: ["name", "company"], additionalProperties: false } },
    sponsors: { type: "array", items: { type: "object", properties: { name: { type: "string" }, company: { type: "string" } }, required: ["name", "company"], additionalProperties: false } },
  },
  required: ["eventName", "eventDescription", "speakers", "sponsors"],
  additionalProperties: false,
} as const;
```

Then the two functions:

```ts
export async function extractEventDetails(client: Anthropic, contextText: string, transcript: string): Promise<EventDetails> {
  const res: any = await client.messages.create({
    model: SUMMARY_MODEL,
    max_tokens: 1024,
    output_config: { format: { type: "json_schema", schema: DETAILS_SCHEMA } },
    messages: buildEventDetailsPrompt(contextText, transcript),
  } as any);
  if (res.stop_reason === "refusal") throw new Error("model refused to extract event details");
  const text = (res.content ?? []).find((b: any) => b.type === "text")?.text ?? "";
  let parsed: any;
  try { parsed = JSON.parse(text); } catch { throw new Error("event details model returned unparseable output"); }
  return {
    eventName: String(parsed.eventName ?? ""),
    eventDescription: String(parsed.eventDescription ?? ""),
    speakers: Array.isArray(parsed.speakers) ? parsed.speakers.map((s: any) => ({ name: String(s.name ?? ""), company: String(s.company ?? "") })) : [],
    sponsors: Array.isArray(parsed.sponsors) ? parsed.sponsors.map((s: any) => ({ name: String(s.name ?? ""), company: String(s.company ?? "") })) : [],
  };
}

export async function generateFormattedSummary(client: Anthropic, format: "linkedin" | "article", transcript: string, details: EventDetails): Promise<string> {
  const messages = format === "linkedin" ? buildLinkedInPrompt(transcript, details) : buildArticlePrompt(transcript, details);
  const res: any = await client.messages.create({ model: SUMMARY_MODEL, max_tokens: 4096, messages } as any);
  if (res.stop_reason === "refusal") throw new Error(`model refused to write the ${format} summary`);
  const text = (res.content ?? []).find((b: any) => b.type === "text")?.text ?? "";
  if (!text.trim()) throw new Error(`${format} model returned empty output`);
  return text.trim();
}
```

- [ ] **Step 5: Add the extraction step to the core pipeline**

In `packages/core/src/transcription.ts`:

Add to `TranscriptionDeps`:

```ts
  extractDetails(contextText: string, transcript: string): Promise<EventDetails>;
```

Import the type (extend the existing import from `./transcribe.js`): add `EventDetails` to that import list.

In `runTranscription`, after the `const summary = await deps.summarize(transcript);` and its `touch(... status: "creating_doc")`, before building the doc, add:

```ts
    const details = await deps.extractDetails(row.contextText ?? "", transcript);
    touch(db, id, { eventDetails: JSON.stringify(details) });
```

(`row.contextText` is available because Task 1 added the column and the route sets it before `startTranscription`.)

- [ ] **Step 6: Pass the dep in the web glue**

In `packages/web/lib/transcriber.ts`, add to the imports from `./anthropic`: `extractEventDetails`. Then inside the `runTranscription(db, id, { ... })` deps object, add:

```ts
      extractDetails: (contextText, transcript) => withBackoff(() => extractEventDetails(client, contextText, transcript)),
```

- [ ] **Step 7: Run tests and build**

Run: `npm -w @event-editor/core run build && npm -w @event-editor/web exec -- vitest run test/context.test.ts test/anthropic-summary.test.ts && npm -w @event-editor/core exec -- vitest run test/transcription.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add packages/web/lib/context.ts packages/web/lib/anthropic.ts packages/web/lib/transcriber.ts packages/core/src/transcription.ts packages/web/test/anthropic-summary.test.ts packages/web/test/context.test.ts packages/core/test/transcription.test.ts
git commit -m "feat: event-details extraction in pipeline, format generation helpers"
```

---

### Task 6: Context upload route and linkage on audio POST

**Files:**
- Create: `packages/web/app/api/transcribe/context/route.ts`
- Modify: `packages/web/lib/context.ts` (add `linkStash`)
- Modify: `packages/web/app/api/transcribe/route.ts` (honour `x-context-id`)
- Test: `packages/web/test/context.test.ts` (extend for `linkStash`)

**Interfaces:**
- Consumes: `stashContext`, `readStash`, `extFromName` (Tasks 4-5); `transcriptions` schema.
- Produces:
  - `export async function linkStash(db, id: number, contextId: string): Promise<boolean>` (sets `contextText` + `contextFilePath` on the row; returns false if stash missing)
  - `POST /api/transcribe/context` returning `{ contextId }` or `{ error }`.

- [ ] **Step 1: Write the failing test**

Append to `packages/web/test/context.test.ts`:

```ts
import { linkStash } from "../lib/context";

describe("linkStash", () => {
  it("writes context text onto the row", async () => {
    const id = await stashContext(Buffer.from("<p>Linked ctx</p>"), "html");
    const set = vi.fn();
    const where = vi.fn(() => ({ run: vi.fn() }));
    const db = { update: () => ({ set: (v: any) => { set(v); return { where }; } }) } as any;
    const ok = await linkStash(db, 7, id);
    expect(ok).toBe(true);
    expect(set.mock.calls[0][0].contextText).toContain("Linked ctx");
  });
  it("returns false for a missing stash", async () => {
    const db = { update: () => ({ set: () => ({ where: () => ({ run: vi.fn() }) }) }) } as any;
    expect(await linkStash(db, 7, "11111111-1111-1111-1111-111111111111")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w @event-editor/web exec -- vitest run test/context.test.ts -t linkStash`
Expected: FAIL (`linkStash` missing).

- [ ] **Step 3: Implement `linkStash`**

Append to `packages/web/lib/context.ts`:

```ts
import { eq } from "drizzle-orm";
import { transcriptions } from "@event-editor/core/schema";

export async function linkStash(db: any, id: number, contextId: string): Promise<boolean> {
  const stash = await readStash(contextId);
  if (!stash) return false;
  db.update(transcriptions)
    .set({ contextText: stash.text, contextFilePath: `data/uploads/context/${contextId}.json`, updatedAt: Date.now() })
    .where(eq(transcriptions.id, id))
    .run();
  return true;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm -w @event-editor/web exec -- vitest run test/context.test.ts -t linkStash`
Expected: PASS.

- [ ] **Step 5: Create the context upload route**

Create `packages/web/app/api/transcribe/context/route.ts`:

```ts
import { NextResponse } from "next/server";
import { extFromName, stashContext } from "@/lib/context";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "file field required" }, { status: 400 });
  const ext = extFromName(file.name);
  if (!ext) return NextResponse.json({ error: "unsupported context type" }, { status: 400 });
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const contextId = await stashContext(buffer, ext);
    return NextResponse.json({ contextId });
  } catch {
    return NextResponse.json({ error: "could not read the context file" }, { status: 500 });
  }
}
```

- [ ] **Step 6: Honour `x-context-id` in the audio POST**

In `packages/web/app/api/transcribe/route.ts`, add the import:

```ts
import { linkStash } from "@/lib/context";
```

Inside `POST`, after the `db.update(...).set({ sourceUploadPath ... })` block and BEFORE `startTranscription(db, id);`, add:

```ts
    const contextId = request.headers.get("x-context-id");
    if (contextId) await linkStash(db, id, contextId);
```

- [ ] **Step 7: Build and run the full web suite**

Run: `npm -w @event-editor/core run build && npm -w @event-editor/web exec -- vitest run`
Expected: PASS (all web tests).

- [ ] **Step 8: Commit**

```bash
git add packages/web/app/api/transcribe/context/route.ts packages/web/lib/context.ts packages/web/app/api/transcribe/route.ts packages/web/test/context.test.ts
git commit -m "feat(web): context upload route and linkage to transcription"
```

---

### Task 7: On-demand format route, details PATCH, and GET extension

**Files:**
- Create: `packages/web/app/api/transcribe/[id]/summary/route.ts`
- Create: `packages/web/app/api/transcribe/[id]/details/route.ts`
- Modify: `packages/web/app/api/transcribe/[id]/route.ts` (extend DTO)
- Test: `packages/web/test/transcribe-format.test.ts` (create)

**Interfaces:**
- Consumes: `generateFormattedSummary`, `extractEventDetails` unused here; `visionClient`, `SUMMARY_MODEL`; `transcriptions` schema; `EventDetails`.
- Produces:
  - `POST /api/transcribe/[id]/summary` body `{ format: "linkedin" | "article" }` returns `{ text }`.
  - `PATCH /api/transcribe/[id]/details` body `EventDetails` returns `{ ok: true }` and nulls cached format columns.
  - Extended GET returns `hasContext`, `eventDetails`, `summaryLinkedin`, `summaryArticle`.
  - A pure helper `export function pickCachedSummary(row, format): string | null` in `packages/web/lib/summary-format.ts`.

- [ ] **Step 1: Write the failing test**

Create `packages/web/test/transcribe-format.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { pickCachedSummary } from "../lib/summary-format";

describe("pickCachedSummary", () => {
  it("reads the cached column for a format", () => {
    const row = { summaryLinkedin: "LI", summaryArticle: null };
    expect(pickCachedSummary(row as any, "linkedin")).toBe("LI");
    expect(pickCachedSummary(row as any, "article")).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm -w @event-editor/web exec -- vitest run test/transcribe-format.test.ts`
Expected: FAIL (`../lib/summary-format` missing).

- [ ] **Step 3: Implement the pure helper**

Create `packages/web/lib/summary-format.ts`:

```ts
export type SummaryFormat = "linkedin" | "article";

export function pickCachedSummary(
  row: { summaryLinkedin: string | null; summaryArticle: string | null },
  format: SummaryFormat,
): string | null {
  return format === "linkedin" ? row.summaryLinkedin : row.summaryArticle;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm -w @event-editor/web exec -- vitest run test/transcribe-format.test.ts`
Expected: PASS.

- [ ] **Step 5: Create the summary route**

Create `packages/web/app/api/transcribe/[id]/summary/route.ts`:

```ts
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { transcriptions } from "@event-editor/core/schema";
import type { EventDetails } from "@event-editor/core/transcribe";
import { getDb } from "@/lib/db";
import { visionClient, generateFormattedSummary } from "@/lib/anthropic";
import { pickCachedSummary, type SummaryFormat } from "@/lib/summary-format";

export const runtime = "nodejs";

const EMPTY: EventDetails = { eventName: "", eventDescription: "", speakers: [], sponsors: [] };

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const format = body.format as SummaryFormat;
  if (format !== "linkedin" && format !== "article") return NextResponse.json({ error: "bad format" }, { status: 400 });
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "ANTHROPIC_API_KEY is not set" }, { status: 400 });

  const db = getDb();
  const row = db.select().from(transcriptions).where(eq(transcriptions.id, Number(id))).all()[0];
  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (!row.transcriptText) return NextResponse.json({ error: "transcript not ready" }, { status: 409 });

  const cached = pickCachedSummary(row as any, format);
  if (cached) return NextResponse.json({ text: cached });

  const details: EventDetails = row.eventDetails ? JSON.parse(row.eventDetails) : EMPTY;
  try {
    const text = await generateFormattedSummary(visionClient(), format, row.transcriptText, details);
    const col = format === "linkedin" ? { summaryLinkedin: text } : { summaryArticle: text };
    db.update(transcriptions).set({ ...col, updatedAt: Date.now() }).where(eq(transcriptions.id, Number(id))).run();
    return NextResponse.json({ text });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "generation failed" }, { status: 500 });
  }
}
```

- [ ] **Step 6: Create the details route**

Create `packages/web/app/api/transcribe/[id]/details/route.ts`:

```ts
import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { transcriptions } from "@event-editor/core/schema";
import type { EventDetails } from "@event-editor/core/transcribe";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";

function clean(d: any): EventDetails {
  const rows = (v: any) => Array.isArray(v) ? v.map((s: any) => ({ name: String(s?.name ?? ""), company: String(s?.company ?? "") })) : [];
  return {
    eventName: String(d?.eventName ?? ""),
    eventDescription: String(d?.eventDescription ?? ""),
    speakers: rows(d?.speakers),
    sponsors: rows(d?.sponsors),
  };
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const details = clean(await req.json().catch(() => ({})));
  // Editing details invalidates the cached formatted summaries.
  getDb().update(transcriptions)
    .set({ eventDetails: JSON.stringify(details), summaryLinkedin: null, summaryArticle: null, updatedAt: Date.now() })
    .where(eq(transcriptions.id, Number(id)))
    .run();
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 7: Extend the GET DTO**

In `packages/web/app/api/transcribe/[id]/route.ts`, extend the returned `transcription` object with:

```ts
      transcriptText: row.transcriptText,
      hasContext: !!row.contextText,
      eventDetails: row.eventDetails ? JSON.parse(row.eventDetails) : null,
      summaryLinkedin: row.summaryLinkedin,
      summaryArticle: row.summaryArticle,
```

- [ ] **Step 8: Build and run web suite**

Run: `npm -w @event-editor/core run build && npm -w @event-editor/web exec -- vitest run`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add packages/web/app/api/transcribe/[id]/summary/route.ts packages/web/app/api/transcribe/[id]/details/route.ts packages/web/app/api/transcribe/[id]/route.ts packages/web/lib/summary-format.ts packages/web/test/transcribe-format.test.ts
git commit -m "feat(web): on-demand format route, details PATCH, GET extension"
```

---

### Task 8: Small UI primitives — Segmented control and CopyButton

**Files:**
- Create: `packages/web/components/Segmented.tsx`
- Create: `packages/web/components/CopyButton.tsx`

**Interfaces:**
- Produces:
  - `Segmented({ options, value, onChange })` where `options: { value: string; label: string }[]`.
  - `CopyButton({ text })` — a `.btn` that copies `text` and swaps its label to "Copied!" for ~1.2s.

No unit test harness for React in this repo; these are verified in Task 10 via the browser. Keep them tiny and dependency-free (`lucide-react` is already available for the copy icon).

- [ ] **Step 1: Create `Segmented.tsx`**

```tsx
"use client";

interface Option { value: string; label: string }

export function Segmented({ options, value, onChange }: { options: Option[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="inline-flex rounded-[10px] bg-[var(--surface-2,#ececec)] p-1 gap-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`rounded-[8px] px-4 py-1.5 text-sm transition-colors ${
            value === o.value ? "bg-white text-ink shadow-sm" : "text-muted hover:text-ink"
          }`}
          aria-pressed={value === o.value}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
```

(If `--surface-2` / `text-ink` / `text-muted` tokens differ in `globals.css`, match the existing names used elsewhere in the app, e.g. in `StatusBadge`.)

- [ ] **Step 2: Create `CopyButton.tsx`**

```tsx
"use client";
import { useState } from "react";
import { Copy, Check } from "lucide-react";

export function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      setTimeout(() => setDone(false), 1200);
    } catch { /* clipboard blocked; ignore */ }
  }
  return (
    <button type="button" className="btn inline-flex items-center gap-2" onClick={copy}>
      {done ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
      {done ? "Copied!" : "Copy"}
    </button>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `npm -w @event-editor/web exec -- tsc --noEmit -p tsconfig.json`
Expected: no errors from these two files.

- [ ] **Step 4: Commit**

```bash
git add packages/web/components/Segmented.tsx packages/web/components/CopyButton.tsx
git commit -m "feat(web): Segmented control and CopyButton primitives"
```

---

### Task 9: Event details panel component

**Files:**
- Create: `packages/web/app/transcribe/EventDetailsPanel.tsx`

**Interfaces:**
- Consumes: `EventDetails` shape (name/description/speakers/sponsors); `PATCH /api/transcribe/[id]/details`.
- Produces: `EventDetailsPanel({ id, initial, onSaved })` — editable fields; Save PATCHes and calls `onSaved()` (so the parent can drop cached format text and re-fetch).

- [ ] **Step 1: Implement the panel**

Create `packages/web/app/transcribe/EventDetailsPanel.tsx`:

```tsx
"use client";
import { useState } from "react";
import { Plus, X } from "lucide-react";

interface Person { name: string; company: string }
export interface Details { eventName: string; eventDescription: string; speakers: Person[]; sponsors: Person[] }

function PeopleEditor({ label, rows, onChange }: { label: string; rows: Person[]; onChange: (r: Person[]) => void }) {
  return (
    <div className="mt-4">
      <p className="text-sm font-medium">{label}</p>
      <div className="mt-2 space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex gap-2">
            <input className="field flex-1" placeholder="Name" value={r.name}
              onChange={(e) => onChange(rows.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
            <input className="field flex-1" placeholder="Company" value={r.company}
              onChange={(e) => onChange(rows.map((x, j) => j === i ? { ...x, company: e.target.value } : x))} />
            <button type="button" className="btn" onClick={() => onChange(rows.filter((_, j) => j !== i))}><X className="w-4 h-4" /></button>
          </div>
        ))}
        <button type="button" className="btn inline-flex items-center gap-2" onClick={() => onChange([...rows, { name: "", company: "" }])}>
          <Plus className="w-4 h-4" /> Add
        </button>
      </div>
    </div>
  );
}

export function EventDetailsPanel({ id, initial, onSaved }: { id: number; initial: Details; onSaved: () => void }) {
  const [d, setD] = useState<Details>(initial);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  async function save() {
    setSaving(true);
    setSaved(false);
    try {
      const r = await fetch(`/api/transcribe/${id}/details`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(d),
      });
      if (r.ok) { setSaved(true); onSaved(); setTimeout(() => setSaved(false), 1500); }
    } finally { setSaving(false); }
  }

  return (
    <div className="card mt-5">
      <p className="eyebrow">Event details</p>
      <p className="mt-2 text-sm text-muted">Correct anything below. Saving updates the LinkedIn and Article versions.</p>
      <label className="mt-4 block text-sm font-medium">Event name
        <input className="field mt-1 w-full" value={d.eventName} onChange={(e) => setD({ ...d, eventName: e.target.value })} />
      </label>
      <label className="mt-4 block text-sm font-medium">Description
        <textarea className="field mt-1 w-full" rows={3} value={d.eventDescription} onChange={(e) => setD({ ...d, eventDescription: e.target.value })} />
      </label>
      <PeopleEditor label="Speakers" rows={d.speakers} onChange={(speakers) => setD({ ...d, speakers })} />
      <PeopleEditor label="Sponsors and partners" rows={d.sponsors} onChange={(sponsors) => setD({ ...d, sponsors })} />
      <div className="mt-4 flex items-center gap-3">
        <button type="button" className="btn btn-accent" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save details"}</button>
        {saved && <span className="text-sm text-success">Saved.</span>}
      </div>
    </div>
  );
}
```

(If the app has no `.field` input class, style the inputs to match the `.card`/`.btn` system in `globals.css`, keeping anti-vibecode field states: default, focus ring, disabled.)

- [ ] **Step 2: Typecheck**

Run: `npm -w @event-editor/web exec -- tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/web/app/transcribe/EventDetailsPanel.tsx
git commit -m "feat(web): editable event details panel"
```

---

### Task 10: Wire the form input and done-state UI together

**Files:**
- Modify: `packages/web/app/transcribe/TranscribeClient.tsx`

**Interfaces:**
- Consumes: `Segmented`, `CopyButton`, `EventDetailsPanel`; routes `/api/transcribe/context`, `/api/transcribe/[id]/summary`; extended GET DTO.

- [ ] **Step 1: Add the context file input to the form**

In `TranscribeClient.tsx`, add a ref and constant near the existing `fileRef`:

```tsx
const ctxRef = useRef<HTMLInputElement>(null);
const CONTEXT_ACCEPT = ".md,.markdown,.html,.pdf,.pptx";
```

In `upload()`, before the audio POST, upload the context file first and capture the header:

```tsx
    let contextId: string | null = null;
    const ctxFile = ctxRef.current?.files?.[0];
    if (ctxFile) {
      const fd = new FormData();
      fd.append("file", ctxFile);
      const cr = await fetch("/api/transcribe/context", { method: "POST", body: fd });
      const cd = await cr.json().catch(() => null);
      if (cr.ok && cd?.contextId) contextId = cd.contextId;
    }
    const headers: Record<string, string> = { "x-filename": file.name };
    if (contextId) headers["x-context-id"] = contextId;
    const r = await fetch("/api/transcribe", { method: "POST", headers, body: file });
```

(Replace the existing single `fetch("/api/transcribe", ...)` call with the version above.)

Add the input to the form card, below the audio input row (inside the same `card`, as its own full-width block):

```tsx
        <div className="basis-full mt-2">
          <p className="text-sm font-medium">Optional: add context (agenda, deck, or notes)</p>
          <input ref={ctxRef} type="file" accept={CONTEXT_ACCEPT} className="mt-1 text-sm text-muted" />
          <p className="mt-1 text-sm text-muted">Accepted: Markdown, HTML, PDF, PPTX. Used to ground the summaries with names and sponsors.</p>
        </div>
```

- [ ] **Step 2: Extend the polled transcription type and state**

Extend the `Transcription` interface with:

```tsx
  transcriptText: string | null;
  hasContext: boolean;
  eventDetails: { eventName: string; eventDescription: string; speakers: { name: string; company: string }[]; sponsors: { name: string; company: string }[] } | null;
  summaryLinkedin: string | null;
  summaryArticle: string | null;
```

Add UI state near the other `useState` hooks:

```tsx
const [format, setFormat] = useState<"general" | "linkedin" | "article">("general");
const [formatText, setFormatText] = useState<Record<string, string>>({});
const [formatBusy, setFormatBusy] = useState(false);
const [formatError, setFormatError] = useState<string | null>(null);
```

- [ ] **Step 3: Add the format loader**

Add this function inside the component:

```tsx
async function loadFormat(fmt: "general" | "linkedin" | "article") {
  setFormat(fmt);
  setFormatError(null);
  if (fmt === "general") return;
  if (formatText[fmt]) return;
  const cached = fmt === "linkedin" ? tx?.summaryLinkedin : tx?.summaryArticle;
  if (cached) { setFormatText((m) => ({ ...m, [fmt]: cached })); return; }
  if (id == null) return;
  setFormatBusy(true);
  try {
    const r = await fetch(`/api/transcribe/${id}/summary`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ format: fmt }),
    });
    const d = await r.json().catch(() => null);
    if (r.ok && d?.text) setFormatText((m) => ({ ...m, [fmt]: d.text }));
    else setFormatError(d?.error ?? "Could not generate this format.");
  } catch { setFormatError("Could not generate this format."); }
  finally { setFormatBusy(false); }
}
```

- [ ] **Step 4: Render the details panel and format toggle in the done state**

Inside the `tx.status === "done"` block, after the existing Google Docs link and summary, add:

```tsx
              {tx.eventDetails && (
                <EventDetailsPanel
                  id={id!}
                  initial={tx.eventDetails}
                  onSaved={() => { setFormatText({}); setFormat("general"); }}
                />
              )}
              <div className="mt-5">
                <Segmented
                  options={[{ value: "general", label: "General" }, { value: "linkedin", label: "LinkedIn" }, { value: "article", label: "Article" }]}
                  value={format}
                  onChange={(v) => loadFormat(v as any)}
                />
                <div className="card mt-3">
                  {format === "general" && (
                    <p className="whitespace-pre-wrap text-ink">{tx.summaryText}</p>
                  )}
                  {format !== "general" && (
                    formatBusy ? <p className="text-muted">Generating…</p>
                    : formatError ? (
                      <div>
                        <p className="text-danger">{formatError}</p>
                        <button className="btn mt-3" onClick={() => loadFormat(format)}>Try again</button>
                      </div>
                    ) : (
                      <>
                        <p className="whitespace-pre-wrap text-ink">{formatText[format]}</p>
                        {formatText[format] && <div className="mt-3"><CopyButton text={formatText[format]} /></div>}
                      </>
                    )
                  )}
                </div>
              </div>
```

Add the imports at the top of the file:

```tsx
import { Segmented } from "@/components/Segmented";
import { CopyButton } from "@/components/CopyButton";
import { EventDetailsPanel } from "./EventDetailsPanel";
```

Remove the now-duplicated standalone General summary block (the old `{tx.summaryText && (<div>...Summary...</div>)}`), since General now renders inside the toggle card. Keep the "Open in Google Docs" link.

- [ ] **Step 5: Build**

Run: `npm -w @event-editor/core run build && npm -w @event-editor/web run build`
Expected: build succeeds (prerender OK).

- [ ] **Step 6: Manual browser verification**

Start the app: `npm run dev` (serves on http://localhost:3000). Then:
1. Go to `/transcribe`. Confirm the optional context input and accepted-types line show under the audio input.
2. Upload a short audio file plus a small `.md` context file. Wait for status "done".
3. Confirm the Event details panel shows extracted name/speakers/sponsors and is editable; edit a speaker and Save; confirm "Saved." appears.
4. Toggle General > LinkedIn > Article. Confirm LinkedIn shows the required structure ("Key takeaways from the session:", "Our sincere thanks to...", hashtags, no sign-off) and Article is a single piece under ~1000 words. Confirm the Copy button swaps to "Copied!".
5. After editing details, confirm re-opening LinkedIn regenerates (cache cleared).

- [ ] **Step 7: Commit**

```bash
git add packages/web/app/transcribe/TranscribeClient.tsx
git commit -m "feat(web): context input and General/LinkedIn/Article toggle in transcriber"
```

---

## Self-review notes

- **Spec coverage:** context upload + parse (Tasks 4, 6); event-details extraction + editable panel (Tasks 2, 5, 7, 9); General/LinkedIn/Article with the exact LinkedIn structure and 1000-word SEO article (Task 3); on-demand + cached generation with cache invalidation on details edit (Tasks 7, 10); schema (Task 1); UI toggle + copy + supported-types line (Tasks 8, 10). No context file falls back to best-effort extraction from the transcript (Task 5 passes `row.contextText ?? ""`).
- **Deferred (unchanged from spec):** LinkedIn/Article are not pushed to the Google Doc; one context file per transcription; General summary still ignores context.
- **Type consistency:** `EventDetails` (core) matches the panel's `Details` shape and the `DETAILS_SCHEMA`; `SummaryFormat = "linkedin" | "article"` in `summary-format.ts` matches the route body and `generateFormattedSummary`'s parameter; column names (`summaryLinkedin`, `summaryArticle`, `contextText`, `eventDetails`) are identical across schema, migration, routes, and DTO.
