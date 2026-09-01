import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { OllamaProvider, ollamaMaxOutputTokens, ollamaTimeoutMs } from "./ollama";
import { AIInvalidOutputError, AIOutputTruncatedError, AIUnavailableError } from "./ai";

const schema = z.object({ name: z.string(), kcal: z.number() });
const provider = () => new OllamaProvider("http://ollama.test", "deepseek-r1", true, 1000, 256);

/** A single non-streamed object, which Ollama still returns for short answers. */
const reply = (content: string, status = 200) =>
  vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: { content } }), { status }));

/** The newline-delimited stream Ollama actually sends for a longer answer. */
const stream = (lines: object[]) =>
  vi.fn().mockResolvedValue(
    new Response(lines.map((line) => `${JSON.stringify(line)}\n`).join(""), { status: 200 }),
  );

/** Splits text into one chunk per token-ish fragment, as a real stream does. */
const chunks = (text: string) => text.split("").map((character) => ({ message: { content: character } }));

afterEach(() => vi.unstubAllGlobals());

describe("Ollama adapter", () => {
  it("uses a 600 second default timeout and accepts a configured override", () => {
    expect(ollamaTimeoutMs(undefined)).toBe(600_000);
    expect(ollamaTimeoutMs("45")).toBe(45_000);
  });

  it("falls back safely for invalid timeout values", () => {
    expect(ollamaTimeoutMs("0")).toBe(600_000);
    expect(ollamaTimeoutMs("not-a-number")).toBe(600_000);
  });

  it("returns validated structured output", async () => {
    vi.stubGlobal("fetch", reply('{"name":"Rice","kcal":130}'));
    await expect(provider().complete({ system: "s", prompt: "p", schema })).resolves.toEqual({
      name: "Rice",
      kcal: 130,
    });
  });

  it("uses a 2048 token output cap and accepts a configured override", () => {
    expect(ollamaMaxOutputTokens(undefined)).toBe(2048);
    expect(ollamaMaxOutputTokens("512")).toBe(512);
    expect(ollamaMaxOutputTokens("0")).toBe(2048);
  });

  /**
   * Streaming is not cosmetic: with stream:false Ollama sends no headers until
   * generation ends, and Node's HTTP client aborts after its own 300 second
   * headers deadline no matter what timeout this adapter passes.
   */
  it("streams, requests JSON format, caps the tokens and asks for no reasoning", async () => {
    const fetchMock = reply('{"name":"Rice","kcal":130}');
    vi.stubGlobal("fetch", fetchMock);
    await provider().complete({ system: "s", prompt: "p", schema });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.stream).toBe(true);
    expect(body.format).toBe("json");
    expect(body.options.num_predict).toBe(256);
    // A reasoning model left to think spends the whole token budget on the
    // chain of thought and never reaches the JSON.
    expect(body.think).toBe(false);
    expect(body.messages[0].role).toBe("system");
  });

  it("retries without the think flag when Ollama rejects it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "model does not support thinking" }), { status: 400 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ message: { content: '{"name":"Rice","kcal":130}' } })));
    vi.stubGlobal("fetch", fetchMock);

    await expect(provider().complete({ system: "s", prompt: "p", schema })).resolves.toMatchObject({ name: "Rice" });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).think).toBe(false);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).think).toBeUndefined();
  });

  it("does not swallow an unrelated 400", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: "invalid format" }), { status: 400 })),
    );
    await expect(provider().complete({ system: "s", prompt: "p", schema })).rejects.toBeInstanceOf(AIUnavailableError);
  });

  /**
   * The failure that reached production: a six-word meal, an empty `content`,
   * and the entire budget spent in `message.thinking`.
   */
  it("blames reasoning when the budget went to thinking and no answer arrived", async () => {
    vi.stubGlobal(
      "fetch",
      stream([
        { message: { thinking: "Let me consider the bread. ".repeat(20) } },
        { done: true, done_reason: "length", eval_count: 256 },
      ]),
    );

    await expect(provider().complete({ system: "s", prompt: "p", schema })).rejects.toMatchObject({
      name: "AIOutputTruncatedError",
      message: expect.stringContaining("reasoning rather than answering"),
    });
  });

  it("reports how many tokens a cut-off answer used", async () => {
    vi.stubGlobal(
      "fetch",
      stream([...chunks('{"name":"Rice","kcal":'), { done: true, done_reason: "length", eval_count: 256 }]),
    );
    await expect(provider().complete({ system: "s", prompt: "p", schema })).rejects.toMatchObject({
      message: expect.stringContaining("after 256 tokens"),
    });
  });

  it("reassembles an answer that arrived in many chunks", async () => {
    vi.stubGlobal("fetch", stream([...chunks('{"name":"Rice","kcal":130}'), { done: true }]));
    await expect(provider().complete({ system: "s", prompt: "p", schema })).resolves.toEqual({
      name: "Rice",
      kcal: 130,
    });
  });

  it("reports a cut-off answer as truncated, not as malformed JSON", async () => {
    vi.stubGlobal("fetch", stream([...chunks('{"name":"Rice","kcal":'), { done: true, done_reason: "length" }]));
    await expect(provider().complete({ system: "s", prompt: "p", schema })).rejects.toBeInstanceOf(
      AIOutputTruncatedError,
    );
  });

  it("surfaces an error Ollama reports inside the stream", async () => {
    vi.stubGlobal("fetch", stream([{ error: "model requires more system memory" }]));
    await expect(provider().complete({ system: "s", prompt: "p", schema })).rejects.toBeInstanceOf(AIUnavailableError);
  });

  it("applies a repair hook before validating", async () => {
    vi.stubGlobal("fetch", reply('{"name":"Rice","kcal":"130"}'));
    await expect(
      provider().complete({
        system: "s",
        prompt: "p",
        schema,
        repair: (value) => ({ ...(value as object), kcal: Number((value as { kcal: string }).kcal) }),
      }),
    ).resolves.toEqual({ name: "Rice", kcal: 130 });
  });

  it("passes a JSON schema through when one is supplied", async () => {
    const fetchMock = reply('{"name":"Rice","kcal":130}');
    vi.stubGlobal("fetch", fetchMock);
    const jsonSchema = { type: "object" };
    await provider().complete({ system: "s", prompt: "p", schema, jsonSchema });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).format).toEqual(jsonSchema);
  });

  it("passes transient image data to a vision-capable model", async () => {
    const fetchMock = reply('{"name":"Rice","kcal":130}');
    vi.stubGlobal("fetch", fetchMock);
    await provider().complete({ system: "s", prompt: "read this", schema, images: ["base64-image"] });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.messages[1]).toMatchObject({ role: "user", images: ["base64-image"] });
  });

  it("strips a reasoning model's thinking block", async () => {
    vi.stubGlobal("fetch", reply('<think>Let me work this out…</think>{"name":"Rice","kcal":130}'));
    await expect(provider().complete({ system: "s", prompt: "p", schema })).resolves.toMatchObject({ name: "Rice" });
  });

  it("recovers JSON from a fenced code block", async () => {
    vi.stubGlobal("fetch", reply('Here you go:\n```json\n{"name":"Rice","kcal":130}\n```'));
    await expect(provider().complete({ system: "s", prompt: "p", schema })).resolves.toMatchObject({ kcal: 130 });
  });

  it("rejects malformed JSON instead of guessing", async () => {
    vi.stubGlobal("fetch", reply("I think rice has about 130 calories."));
    await expect(provider().complete({ system: "s", prompt: "p", schema })).rejects.toBeInstanceOf(
      AIInvalidOutputError,
    );
  });

  it("rejects JSON that does not match the schema", async () => {
    vi.stubGlobal("fetch", reply('{"name":"Rice","kcal":"a lot"}'));
    await expect(provider().complete({ system: "s", prompt: "p", schema })).rejects.toBeInstanceOf(
      AIInvalidOutputError,
    );
  });

  it("surfaces an outage as a typed error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    await expect(provider().complete({ system: "s", prompt: "p", schema })).rejects.toBeInstanceOf(AIUnavailableError);

    vi.unstubAllGlobals();
    vi.stubGlobal("fetch", reply("{}", 500));
    await expect(provider().complete({ system: "s", prompt: "p", schema })).rejects.toBeInstanceOf(AIUnavailableError);
  });

  it("reports a missing model rather than calling it", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ models: [{ name: "llama3:8b" }] }), { status: 200 })),
    );
    await expect(provider().capabilities()).rejects.toBeInstanceOf(AIUnavailableError);
  });

  it("detects a configured model that is present", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ models: [{ name: "deepseek-r1:latest" }] }), { status: 200 })),
    );
    await expect(provider().capabilities()).resolves.toMatchObject({ model: "deepseek-r1", structuredOutput: true });
  });
});
