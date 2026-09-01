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

/**
 * The model was stopped by the output limit rather than by finishing. Its own
 * class because the remedy is different from every other invalid answer: either
 * the schema permits an answer that is too long, or the limit is too low. Left
 * as valid JSON it would be reported as "response was not valid JSON", which
 * points at the wrong thing entirely.
 */
export class AIOutputTruncatedError extends Error {
  constructor(
    public readonly maxOutputTokens: number,
    generatedTokens?: number | null,
    /** Characters of chain-of-thought, when the model produced any. */
    thinkingChars = 0,
  ) {
    // Which half of the budget was spent decides the remedy, so the message
    // names it. Reasoning eating the whole allowance and a genuinely long answer
    // both look like "cut off" otherwise.
    const spent = generatedTokens ? ` after ${generatedTokens} tokens` : "";
    const reasoning = thinkingChars
      ? `; ${thinkingChars} characters of it were the model reasoning rather than answering`
      : "";
    super(`Model output was cut off at the ${maxOutputTokens} token limit${spent}${reasoning}`);
    this.name = "AIOutputTruncatedError";
  }
}

export interface AIProvider {
  readonly name: string;
  readonly enabled: boolean;
  capabilities(): Promise<AICapabilities>;
  /**
   * Output is always validated against `schema`; prose is never parsed. `repair`
   * runs on the decoded JSON before validation, for the values a grammar cannot
   * constrain - see `src/server/ai-repair.ts`.
   */
  complete<T>(input: {
    system: string;
    prompt: string;
    schema: z.ZodType<T>;
    jsonSchema?: unknown;
    images?: string[];
    repair?: (value: unknown) => unknown;
  }): Promise<T>;
}
