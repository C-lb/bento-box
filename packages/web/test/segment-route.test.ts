import { vi, describe, it, expect, beforeEach } from "vitest";

const { segmentSpeakers, segmentByTopic } = vi.hoisted(() => ({
  segmentSpeakers: vi.fn(async () => [{ speaker: "A", startSlide: 1, endSlide: 1 }]),
  segmentByTopic: vi.fn(async () => [{ speaker: "T", startSlide: 1, endSlide: 1 }]),
}));

vi.mock("@/lib/anthropic", () => ({
  visionClient: () => ({}),
  segmentSpeakers,
  segmentByTopic,
}));

import { POST } from "@/app/api/slice/segment/route";

const slides = [{ index: 1, text: "x", notes: "" }];

function req(body: unknown) {
  return new Request("http://x/api/slice/segment", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ANTHROPIC_API_KEY = "test";
});

describe("segment route dispatch", () => {
  it("routes to segmentByTopic when by=topic", async () => {
    const res = await POST(req({ slides, by: "topic" }));
    expect(res.status).toBe(200);
    expect(segmentByTopic).toHaveBeenCalledOnce();
    expect(segmentSpeakers).not.toHaveBeenCalled();
  });

  it("defaults to segmentSpeakers", async () => {
    const res = await POST(req({ slides }));
    expect(res.status).toBe(200);
    expect(segmentSpeakers).toHaveBeenCalledOnce();
    expect(segmentByTopic).not.toHaveBeenCalled();
  });
});
