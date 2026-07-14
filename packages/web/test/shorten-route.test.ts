import { describe, it, expect, vi, afterEach } from "vitest";
import {
  validateLongUrl,
  validateCustomName,
  buildCreateUrl,
  buildTinyurlUrl,
  classifyCreatePhp,
  classifyTinyurl,
  mapServiceError,
  MSG,
} from "@/lib/shorten";
import { POST } from "@/app/api/shorten/route";

afterEach(() => vi.restoreAllMocks());

function req(body: unknown) {
  return new Request("http://x/api/shorten", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("validateLongUrl", () => {
  it("accepts a plain http url", () => {
    expect(validateLongUrl("http://example.com")).toBeNull();
  });
  it("accepts a plain https url", () => {
    expect(validateLongUrl("https://example.com/foo?bar=1")).toBeNull();
  });
  it("rejects empty input", () => {
    expect(validateLongUrl("")).not.toBeNull();
  });
  it("rejects a non-url string", () => {
    expect(validateLongUrl("not a url")).not.toBeNull();
  });
  it("rejects a non-http(s) scheme", () => {
    expect(validateLongUrl("ftp://example.com")).not.toBeNull();
  });
});

describe("validateCustomName", () => {
  it("accepts undefined (optional field)", () => {
    expect(validateCustomName(undefined)).toBeNull();
  });
  it("accepts a valid 5-char name", () => {
    expect(validateCustomName("abcde")).toBeNull();
  });
  it("accepts a valid 30-char name", () => {
    expect(validateCustomName("a".repeat(30))).toBeNull();
  });
  it("accepts underscores and digits", () => {
    expect(validateCustomName("my_link_123")).toBeNull();
  });
  it("rejects a name shorter than 5 chars", () => {
    expect(validateCustomName("abcd")).not.toBeNull();
  });
  it("rejects a name longer than 30 chars", () => {
    expect(validateCustomName("a".repeat(31))).not.toBeNull();
  });
  it("rejects disallowed characters", () => {
    expect(validateCustomName("bad name!")).not.toBeNull();
  });
});

describe("buildCreateUrl", () => {
  it("encodes the url and requests json format", () => {
    const out = buildCreateUrl("is.gd", "https://example.com/a b");
    expect(out).toContain("https://is.gd/create.php");
    expect(out).toContain("format=json");
    expect(out).toContain(`url=${encodeURIComponent("https://example.com/a b")}`);
  });
  it("includes the shorturl param when a custom name is given", () => {
    const out = buildCreateUrl("is.gd", "https://example.com", "mylink");
    expect(out).toContain("shorturl=mylink");
  });
  it("omits the shorturl param when no custom name is given", () => {
    const out = buildCreateUrl("is.gd", "https://example.com");
    expect(out).not.toContain("shorturl=");
  });
  it("builds against v.gd when that service is requested", () => {
    const out = buildCreateUrl("v.gd", "https://example.com");
    expect(out).toContain("https://v.gd/create.php");
  });
});

describe("buildTinyurlUrl", () => {
  it("targets the TinyURL create endpoint with an encoded url", () => {
    const out = buildTinyurlUrl("https://example.com/a b");
    expect(out).toContain("https://tinyurl.com/api-create.php");
    expect(out).toContain(`url=${encodeURIComponent("https://example.com/a b")}`);
  });
  it("passes a custom name through as the alias param", () => {
    const out = buildTinyurlUrl("https://example.com", "mylink");
    expect(out).toContain("alias=mylink");
  });
});

describe("classifyCreatePhp", () => {
  it("returns the short url on a good JSON response", () => {
    expect(classifyCreatePhp(JSON.stringify({ shorturl: "https://is.gd/x" }))).toEqual({
      ok: true,
      shorturl: "https://is.gd/x",
    });
  });
  it("treats the 'database insert failed' throttle page as throttled, not a network failure", () => {
    const out = classifyCreatePhp("Error, database insert failed");
    expect(out).toMatchObject({ ok: false, kind: "throttled" });
  });
  it("maps errorcode 1 (bad/blocked url) to a rejected outcome", () => {
    expect(classifyCreatePhp(JSON.stringify({ errorcode: 1 }))).toMatchObject({ ok: false, kind: "rejected" });
  });
  it("maps errorcode 2 (custom taken) to a rejected outcome", () => {
    expect(classifyCreatePhp(JSON.stringify({ errorcode: 2 }))).toMatchObject({ ok: false, kind: "rejected" });
  });
  it("maps errorcode 3 (rate limit) to throttled", () => {
    expect(classifyCreatePhp(JSON.stringify({ errorcode: 3 }))).toMatchObject({ ok: false, kind: "throttled" });
  });
  it("treats a 200 with no shorturl as throttled", () => {
    expect(classifyCreatePhp(JSON.stringify({}))).toMatchObject({ ok: false, kind: "throttled" });
  });
});

describe("classifyTinyurl", () => {
  it("returns the short url when the body is a plain URL", () => {
    expect(classifyTinyurl("https://tinyurl.com/abc123")).toEqual({ ok: true, shorturl: "https://tinyurl.com/abc123" });
  });
  it("trims surrounding whitespace off the short url", () => {
    expect(classifyTinyurl("  https://tinyurl.com/abc123\n")).toEqual({
      ok: true,
      shorturl: "https://tinyurl.com/abc123",
    });
  });
  it("treats a plain error body as throttled when no custom name was asked for", () => {
    expect(classifyTinyurl("Error")).toMatchObject({ ok: false, kind: "throttled" });
  });
  it("treats an error as a rejected custom name when a custom name was asked for", () => {
    expect(classifyTinyurl("Error", "mylink")).toMatchObject({ ok: false, kind: "rejected" });
  });
});

const UNAVAILABLE = MSG.serviceThrottled;

describe("mapServiceError", () => {
  it("maps code 2 (bad custom name / already taken)", () => {
    expect(mapServiceError(2)).toBe(MSG.customTaken);
  });
  it("maps code 3 (rate limited)", () => {
    expect(mapServiceError(3)).toBe("Rate limit reached. Wait a moment and try again.");
  });
  it("maps code 4 (any other error / maintenance) to the unavailable message", () => {
    expect(mapServiceError(4)).toBe(UNAVAILABLE);
  });
  it("falls back to the unavailable message for an undefined code", () => {
    expect(mapServiceError(undefined)).toBe(UNAVAILABLE);
  });
});

function textResponse(bodies: string[]) {
  const mock = vi.spyOn(globalThis, "fetch");
  for (const b of bodies) mock.mockResolvedValueOnce(new Response(b, { status: 200 }));
  return mock;
}

describe("POST /api/shorten", () => {
  it("returns the shortened url on success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ shorturl: "https://is.gd/abc123" }), { status: 200 }),
    );
    const res = await POST(req({ url: "https://example.com" }));
    expect(res.status).toBe(200);
    expect((await res.json()).shorturl).toBe("https://is.gd/abc123");
  });

  it("falls back to TinyURL when is.gd and v.gd both throttle (the real bug)", async () => {
    const mock = textResponse([
      "Error, database insert failed", // is.gd
      "Error, database insert failed", // v.gd
      "https://tinyurl.com/rescue1", // TinyURL
    ]);
    const res = await POST(req({ url: "https://example.com/a/very/long/path" }));
    expect(res.status).toBe(200);
    expect((await res.json()).shorturl).toBe("https://tinyurl.com/rescue1");
    expect(mock).toHaveBeenCalledTimes(3);
  });

  it("forwards a custom name to TinyURL as an alias when falling back", async () => {
    const mock = textResponse([
      "Error, database insert failed", // is.gd
      "Error, database insert failed", // v.gd
      "https://tinyurl.com/mylink", // TinyURL
    ]);
    await POST(req({ url: "https://example.com", custom: "mylink" }));
    const tinyCall = String(mock.mock.calls[2][0]);
    expect(tinyCall).toContain("api-create.php");
    expect(tinyCall).toContain("alias=mylink");
  });

  it("says the services are throttling (not a network block) when all three are reached but refuse", async () => {
    textResponse([
      "Error, database insert failed",
      "Error, database insert failed",
      "Error", // TinyURL plain error
    ]);
    const res = await POST(req({ url: "https://example.com" }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe(MSG.throttledAll);
    expect(body.error).not.toMatch(/dns|blocking/i);
  });

  it("reports a genuine network failure only when no provider responds at all", async () => {
    const mock = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network down"));
    const res = await POST(req({ url: "https://example.com" }));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe(MSG.unreachableAll);
    // Tries all three providers before concluding the network is down.
    expect(mock).toHaveBeenCalledTimes(3);
  });

  it("stops and reports a blocked link on errorcode 1 without trying other providers", async () => {
    const mock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ errorcode: 1 }), { status: 200 }));
    const res = await POST(req({ url: "https://example.com" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(MSG.blockedUrl);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("stops and reports a taken custom name on errorcode 2", async () => {
    const mock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ errorcode: 2 }), { status: 200 }));
    const res = await POST(req({ url: "https://example.com", custom: "taken" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe(MSG.customTaken);
    expect(mock).toHaveBeenCalledTimes(1);
  });

  it("returns 400 on invalid body (missing url)", async () => {
    expect((await POST(req({}))).status).toBe(400);
  });

  it("returns 400 on malformed json body", async () => {
    const badReq = new Request("http://x/api/shorten", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not json",
    });
    expect((await POST(badReq)).status).toBe(400);
  });

  it("returns 400 for a service outside the is.gd/v.gd whitelist", async () => {
    const res = await POST(req({ url: "https://example.com", service: "evil.example" }));
    expect(res.status).toBe(400);
  });

  it("defaults to is.gd when no service is given", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ shorturl: "https://is.gd/abc123" }), { status: 200 }));
    await POST(req({ url: "https://example.com" }));
    expect(String(fetchMock.mock.calls[0][0])).toContain("is.gd");
  });

  it("passes an AbortSignal so requests time out", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ shorturl: "https://is.gd/abc123" }), { status: 200 }));
    await POST(req({ url: "https://example.com" }));
    const init = fetchMock.mock.calls[0][1] as RequestInit | undefined;
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });
});
