import { z } from "zod";

export interface AICapabilities {
  /** The model accepts a JSON schema and constrains its output to it. */
  structuredOutput: boolean;
  model: string;
}

export class AIUnavailableError extends Error {
  constructor(
    public readonly provider: string,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AIUnavailableError";
  }
}

export class AIInvalidOutputError extends Error {
  constructor(public readonly issues: string) {
    super(`Model returned data that failed validation: ${issues}`);
    this.name = "AIInvalidOutputError";
  }
}

export interface AIProvider {
  readonly name: string;
  readonly enabled: boolean;
  capabilities(): Promise<AICapabilities>;
  /** Output is always validated against `schema`; prose is never parsed. */
  complete<T>(input: { system: string; prompt: string; schema: z.ZodType<T>; jsonSchema?: unknown; images?: string[] }): Promise<T>;
}
