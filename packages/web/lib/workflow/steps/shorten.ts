import {
  validateLongUrl,
  buildCreateUrl,
  buildTinyurlUrl,
  classifyCreatePhp,
  classifyTinyurl,
} from "@/lib/shorten";
import type { StepAdapter } from "../types";

// Corrected vs. an earlier planning pass: `validateLongUrl` returns an error
// `string | null` (not the URL itself), `ShortenService` is "is.gd" | "v.gd"
// (not "isgd"), and `ProviderOutcome`'s success field is `shorturl` (lowercase).
export interface ShortenParams {
  service: "is.gd" | "v.gd" | "tinyurl";
  custom?: string;
}

export const shortenStep: StepAdapter<{ text: string }, ShortenParams, { text: string }> = {
  inputKind: "url-text",
  outputKind: "url-text",
  paramsSchema: {
    type: "object",
    properties: {
      service: { type: "string", enum: ["is.gd", "v.gd", "tinyurl"] },
      custom: { type: "string" },
    },
    required: ["service"],
    additionalProperties: false,
  },
  async run(input, params) {
    const urlError = validateLongUrl(input.text);
    if (urlError) throw new Error(urlError);
    const url = input.text.trim();
    const createUrl =
      params.service === "tinyurl"
        ? buildTinyurlUrl(url, params.custom)
        : buildCreateUrl(params.service, url, params.custom);
    const res = await fetch(createUrl);
    const body = await res.text();
    const outcome = params.service === "tinyurl" ? classifyTinyurl(body, params.custom) : classifyCreatePhp(body);
    if (!outcome.ok) throw new Error(outcome.error);
    return { text: outcome.shorturl };
  },
};
