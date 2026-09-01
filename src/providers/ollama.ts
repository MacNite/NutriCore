import { z } from "zod";
import { AIInvalidOutputError, AIUnavailableError, type AICapabilities, type AIProvider } from "./ai";

const chatResponse = z.object({
  message: z.object({ content: z.string() }).optional(),
  response: z.string().optional(),
});

const DEFAULT_TIMEOUT_MS = 600_000;

/** Convert the runtime setting defensively for callers that do not parse env(). */
export function ollamaTimeoutMs(value = process.env.OLLAMA_TIMEOUT_SECONDS): number {
  if (value === undefined || value.trim() === "") return DEFAULT_TIMEOUT_MS;
  const seconds = Number(value);
  return Number.isInteger(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_TIMEOUT_MS;
}

/**
 * Ollama adapter. It asks for schema-constrained JSON where the model supports
 * it and always validates the result, so a malformed answer is rejected rather
 * than guessed at.
 */
export class OllamaProvider implements AIProvider {
  readonly name = "ollama";

  constructor(
    private baseUrl = process.env.AI_BASE_URL ?? process.env.OLLAMA_BASE_URL ?? "http://ollama:11434",
    private model = process.env.AI_MODEL ?? process.env.OLLAMA_MODEL ?? "qwen3.5:4b",
    public readonly enabled = (process.env.AI_ENABLED ?? "true") !== "false",
    private timeoutMs = ollamaTimeoutMs(),
  ) {}

  async capabilities(): Promise<AICapabilities> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new AIUnavailableError(this.name, `Ollama responded with ${response.status}`);
      const data = (await response.json()) as { models?: { name?: string }[] };
      const names = (data.models ?? []).map((m) => m.name ?? "");
      const present = names.some((name) => name === this.model || name.startsWith(`${this.model}:`));
      if (!present) throw new AIUnavailableError(this.name, `Model ${this.model} is not available`);
      // Not every model honours a JSON schema; the format request degrades to
      // plain JSON mode where it is unsupported.
      return { structuredOutput: true, model: this.model };
    } catch (error) {
      if (error instanceof AIUnavailableError) throw error;
      throw new AIUnavailableError(this.name, "Ollama is unreachable", error);
    }
  }

  async complete<T>({
    system,
    prompt,
    schema,
    jsonSchema,
    images,
  }: {
    system: string;
    prompt: string;
    schema: z.ZodType<T>;
    jsonSchema?: unknown;
    images?: string[];
  }): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          stream: false,
          format: jsonSchema ?? "json",
          options: { temperature: 0.2 },
          messages: [
            { role: "system", content: system },
            { role: "user", content: prompt, ...(images?.length ? { images } : {}) },
          ],
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new AIUnavailableError(this.name, "Ollama request failed", error);
    }

    if (!response.ok) throw new AIUnavailableError(this.name, `Ollama responded with ${response.status}`);

    const envelope = chatResponse.safeParse(await response.json());
    if (!envelope.success) throw new AIUnavailableError(this.name, "Ollama returned an unexpected envelope");

    const content = envelope.data.message?.content ?? envelope.data.response ?? "";
    // Reasoning models emit a thinking block before the answer; drop it.
    const cleaned = content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJson(cleaned));
    } catch {
      throw new AIInvalidOutputError("response was not valid JSON");
    }

    const result = schema.safeParse(parsed);
    if (!result.success) {
      throw new AIInvalidOutputError(result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    }
    return result.data;
  }
}

/** Pulls the outermost JSON object out of a response that carries extra prose. */
function extractJson(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return trimmed;
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start !== -1 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}
