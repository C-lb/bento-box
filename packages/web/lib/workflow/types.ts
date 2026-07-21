export type StepKind =
  | "file"
  | "files"
  | "url-text"
  | "drive-ranked-list"
  | "doc"
  | "headshot-batch"
  | "none";

export interface StepAdapter<Input = unknown, Params = unknown, Output = unknown> {
  inputKind: StepKind;
  outputKind: StepKind;
  paramsSchema: Record<string, unknown>;
  run(input: Input, params: Params): Promise<Output>;
}
