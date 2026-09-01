import { z } from "zod";
import { resolveAiBaseUrl, resolveAiModel } from "@/lib/env";
import { AIInvalidOutputError, AIOutputTruncatedError, AIUnavailableError, AIVisionUnsupportedError, type AICapabilities, type AIProvider } from "./ai";

/**
 * One line of Ollama's streaming response. Everything but the text is optional.
 *
 * `thinking` matters: a reasoning model's chain of thought arrives in its own
 * field, not in `content`, and it is counted against `num_predict` like any
 * other token. Reading it is the only way to tell "the model wrote too much
 * JSON" apart from "the model spent its whole budget thinking and never got to
 * the JSON" - which look identical from `content` alone, because `content` is
 * then empty.
 */
const streamChunk = z.object({
  message: z
    .object({ content: z.string().optional(), thinking: z.string().optional() })
    .optional(),
  response: z.string().optional(),
  thinking: z.string().optional(),
  done: z.boolean().optional(),
  done_reason: z.string().optional(),
  eval_count: z.number().optional(),
  error: z.string().optional(),
});

const DEFAULT_TIMEOUT_MS = 600_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 2048;

/** Convert the runtime setting defensively for callers that do not parse env(). */
export function ollamaTimeoutMs(value = process.env.OLLAMA_TIMEOUT_SECONDS): number {
  if (value === undefined || value.trim() === "") return DEFAULT_TIMEOUT_MS;
  const seconds = Number(value);
  return Number.isInteger(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_TIMEOUT_MS;
}

/**
 * Upper bound on generated tokens, passed to Ollama as `num_predict`.
 *
 * Without one, a schema that permits an open-ended object or a long array lets a
 * model generate until something else stops it. That is not hypothetical: an
 * unbounded `record` in the nutrient extraction schema produced grammars under
 * which the model was never obliged to finish, and every such request died at
 * the HTTP client's own deadline instead of returning anything usable.
 */
export function ollamaMaxOutputTokens(value = process.env.OLLAMA_MAX_OUTPUT_TOKENS): number {
  if (value === undefined || value.trim() === "") return DEFAULT_MAX_OUTPUT_TOKENS;
  const tokens = Number(value);
  return Number.isInteger(tokens) && tokens > 0 ? tokens : DEFAULT_MAX_OUTPUT_TOKENS;
}

/**
 * Ollama adapter. It asks for schema-constrained JSON where the model supports
 * it and always validates the result, so a malformed answer is rejected rather
 * than guessed at.
 *
 * The request streams. That is not about showing progress: with `stream: false`
 * Ollama sends no response headers until generation has finished, and Node's
 * HTTP client aborts a request whose headers have not arrived within its own
 * `headersTimeout` - 300 seconds by default, regardless of the AbortSignal this
 * adapter passes. On a CPU-only host generating at around 12 tokens a second,
 * that made every longer answer impossible to deliver: the request always failed
 * at five minutes with nothing to show, whatever OLLAMA_TIMEOUT_SECONDS said.
 * Streaming makes the headers arrive immediately and each chunk resets the body
 * deadline, so `timeoutMs` is once again the only limit that applies.
 */
export class OllamaProvider implements AIProvider {
  readonly name = "ollama";

  constructor(
    private baseUrl = resolveAiBaseUrl(),
    private model = resolveAiModel(),
    public readonly enabled = (process.env.AI_ENABLED ?? "true") !== "false",
    private timeoutMs = ollamaTimeoutMs(),
    private maxOutputTokens = ollamaMaxOutputTokens(),
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
    repair,
  }: {
    system: string;
    prompt: string;
    schema: z.ZodType<T>;
    jsonSchema?: unknown;
    images?: string[];
    repair?: (value: unknown) => unknown;
  }): Promise<T> {
    const body = (think: boolean | undefined) =>
      JSON.stringify({
        model: this.model,
        stream: true,
        format: jsonSchema ?? "json",
        options: { temperature: 0.2, num_predict: this.maxOutputTokens },
        // Structured extraction wants an answer, not a deliberation. A reasoning
        // model left to think spends `num_predict` on the chain of thought and
        // can be stopped before it ever reaches the JSON - which is exactly what
        // a six-word quick meal did, at 2048 tokens and 161 seconds.
        ...(think === undefined ? {} : { think }),
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt, ...(images?.length ? { images } : {}) },
        ],
      });

    let response = await this.post(body(false));
    // Older Ollama builds, and models with no thinking template, reject the
    // field outright. Retry once without it rather than failing the job.
    if (response.status === 400) {
      const complaint = await response.text().catch(() => "");
      if (/think/i.test(complaint)) response = await this.post(body(undefined));
      else if (images?.length && /(?:image|vision|multimodal).*(?:not support|unsupported)|does not support.*(?:image|vision)/i.test(complaint)) {
        throw new AIVisionUnsupportedError();
      } else throw new AIUnavailableError(this.name, `Ollama responded with 400`, complaint.slice(0, 300));
    }

    if (!response.ok) throw new AIUnavailableError(this.name, `Ollama responded with ${response.status}`);

    const { content, thinking, truncated, generatedTokens } = await this.readStream(response);

    // A model that ignores `think: false` still emits an inline block; drop it.
    const cleaned = content.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
    const cutOff = () => new AIOutputTruncatedError(this.maxOutputTokens, generatedTokens, thinking.length);

    let parsed: unknown;
    try {
      parsed = JSON.parse(extractJson(cleaned));
    } catch {
      // A cut-off answer is almost never valid JSON, and reporting it as such
      // hides the real problem: the model was still writing when it was stopped.
      if (truncated || (!cleaned && thinking)) throw cutOff();
      throw new AIInvalidOutputError("response was not valid JSON");
    }

    const result = schema.safeParse(repair ? repair(parsed) : parsed);
    if (!result.success) {
      if (truncated) throw cutOff();
      throw new AIInvalidOutputError(result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
    }
    return result.data;
  }

  private async post(body: string): Promise<Response> {
    try {
      return await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      throw new AIUnavailableError(this.name, "Ollama request failed", error);
    }
  }

  /**
   * Concatenates the text of a streamed response.
   *
   * Ollama emits one JSON object per line, but a TCP read can end anywhere, so
   * only complete lines are parsed and the remainder is carried into the next
   * read. Whatever is left when the stream ends is parsed too: a short answer can
   * come back as a single object with no trailing newline, and a server that
   * chose not to stream at all still has to work.
   */
  private async readStream(
    response: Response,
  ): Promise<{ content: string; thinking: string; truncated: boolean; generatedTokens: number | null }> {
    if (!response.body) throw new AIUnavailableError(this.name, "Ollama returned an empty response body");

    const decoder = new TextDecoder();
    const reader = response.body.getReader();
    let buffered = "";
    let content = "";
    let thinking = "";
    let truncated = false;
    let generatedTokens: number | null = null;
    let sawChunk = false;
    let drained = false;

    const take = (line: string) => {
      const chunk = takeChunk(line, this.name);
      sawChunk = true;
      content += chunk.text;
      thinking += chunk.thinking;
      truncated = truncated || chunk.truncated;
      if (chunk.generatedTokens !== undefined) generatedTokens = chunk.generatedTokens;
    };

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (value) buffered += decoder.decode(value, { stream: true });
        if (done) buffered += decoder.decode();

        let newline = buffered.indexOf("\n");
        while (newline !== -1) {
          const line = buffered.slice(0, newline).trim();
          buffered = buffered.slice(newline + 1);
          if (line) take(line);
          newline = buffered.indexOf("\n");
        }

        if (done) {
          drained = true;
          break;
        }
      }
    } catch (error) {
      // A problem Ollama reported inside the stream already says what it was.
      if (error instanceof AIUnavailableError) throw error;
      // A stalled or severed stream is an outage, not a malformed answer.
      throw new AIUnavailableError(this.name, "Ollama request failed", error);
    } finally {
      // Leaving a partly-read body open would hold the connection until the
      // model finished generating into it; cancelling tells it to stop.
      if (drained) reader.releaseLock();
      else await reader.cancel().catch(() => undefined);
    }

    // A response that never streamed is still valid JSON when the server chose
    // not to stream at all; accept it rather than failing on the envelope shape.
    const trailing = buffered.trim();
    if (trailing) take(trailing);

    if (!sawChunk) throw new AIUnavailableError(this.name, "Ollama returned an unexpected envelope");
    return { content, thinking, truncated, generatedTokens };
  }
}

function takeChunk(
  line: string,
  provider: string,
): { text: string; thinking: string; truncated: boolean; generatedTokens?: number } {
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    throw new AIUnavailableError(provider, "Ollama returned an unexpected envelope");
  }
  const parsed = streamChunk.safeParse(raw);
  if (!parsed.success) throw new AIUnavailableError(provider, "Ollama returned an unexpected envelope");
  // Ollama reports a mid-stream problem in the payload, not in the HTTP status.
  if (parsed.data.error) throw new AIUnavailableError(provider, `Ollama reported: ${parsed.data.error.slice(0, 200)}`);

  return {
    text: parsed.data.message?.content ?? parsed.data.response ?? "",
    thinking: parsed.data.message?.thinking ?? parsed.data.thinking ?? "",
    truncated: parsed.data.done_reason === "length",
    generatedTokens: parsed.data.eval_count,
  };
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
