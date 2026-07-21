import type Anthropic from "@anthropic-ai/sdk";
import { CHAINABLE_KINDS, canFollow, isChainable, kindsFor } from "./compat";

const PLANNER_MODEL = process.env.EE_PLANNER_MODEL ?? "claude-opus-4-8";

export interface ProposedStep {
  toolId: string;
  instructionText: string;
}

const PLAN_SCHEMA = {
  type: "object",
  properties: {
    steps: {
      type: "array",
      items: {
        type: "object",
        properties: {
          toolId: { type: "string" },
          instructionText: { type: "string" },
        },
        required: ["toolId", "instructionText"],
        additionalProperties: false,
      },
    },
  },
  required: ["steps"],
  additionalProperties: false,
} as const;

function compatTableForPrompt(): string {
  return CHAINABLE_KINDS.map((k) => `${k.toolId}: input=${k.inputKind}, output=${k.outputKind}`).join("\n");
}

function buildPlannerPrompt(goal: string): string {
  return [
    "You plan a linear chain of tool steps to accomplish a user's goal.",
    "Only propose tools from this list, and only place a tool immediately after another if the prior tool's output kind equals the next tool's input kind (a tool with input kind 'none' may only be first):",
    compatTableForPrompt(),
    `User's goal: ${goal}`,
    "Return an ordered array of {toolId, instructionText} describing each step in the user's own words for that step.",
  ].join("\n\n");
}

export async function proposeChain(client: Anthropic, goal: string): Promise<ProposedStep[]> {
  const res: any = await client.messages.create({
    model: PLANNER_MODEL,
    max_tokens: 2048,
    output_config: { format: { type: "json_schema", schema: PLAN_SCHEMA } },
    messages: [{ role: "user", content: buildPlannerPrompt(goal) }],
  } as any);

  if (res.stop_reason === "refusal") {
    throw new Error("planner model refused to propose a chain");
  }
  const text = (res.content ?? []).find((b: any) => b.type === "text")?.text ?? "";
  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("planner model returned unparseable output");
  }
  const raw: ProposedStep[] = Array.isArray(parsed.steps) ? parsed.steps : [];

  // Never trust the model to have honored the compatibility constraint —
  // re-validate every adjacency server-side and truncate at the first break.
  const validated: ProposedStep[] = [];
  let prevOutputKind: string | null = null;
  for (const step of raw) {
    if (!isChainable(step.toolId)) continue;
    const kinds = kindsFor(step.toolId)!;
    if (prevOutputKind === null) {
      // First step: any chainable tool may start (including inputKind "none").
    } else if (!canFollow(prevOutputKind as any, kinds.inputKind)) {
      break;
    }
    validated.push({ toolId: step.toolId, instructionText: String(step.instructionText ?? "") });
    prevOutputKind = kinds.outputKind;
  }
  return validated;
}

export async function synthesizeParams(
  client: Anthropic,
  toolId: string,
  instructionText: string,
  paramsSchema: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res: any = await client.messages.create({
    model: PLANNER_MODEL,
    max_tokens: 1024,
    output_config: { format: { type: "json_schema", schema: paramsSchema } },
    messages: [
      {
        role: "user",
        content: `Infer the parameters for the "${toolId}" tool step from this instruction: "${instructionText}". Return only the parameter values matching the schema.`,
      },
    ],
  } as any);

  if (res.stop_reason === "refusal") {
    throw new Error(`param synthesis refused for step "${toolId}"`);
  }
  const text = (res.content ?? []).find((b: any) => b.type === "text")?.text ?? "";
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`param synthesis for "${toolId}" returned unparseable output`);
  }
}
