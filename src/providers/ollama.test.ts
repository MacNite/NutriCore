import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { OllamaProvider, ollamaTimeoutMs } from "./ollama";
import { AIInvalidOutputError, AIUnavailableError } from "./ai";

const schema = z.object({ name: z.string(), kcal: z.number() });
const provider = () => new OllamaProvider("http://ollama.test", "deepseek-r1", true, 1000);

const reply = (content: string, status = 200) =>
  vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: { content } }), { status }));

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

  it("requests JSON format and does not stream", async () => {
    const fetchMock = reply('{"name":"Rice","kcal":130}');
    vi.stubGlobal("fetch", fetchMock);
    await provider().complete({ system: "s", prompt: "p", schema });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.stream).toBe(false);
    expect(body.format).toBe("json");
    expect(body.messages[0].role).toBe("system");
  });

  it("passes a JSON schema through when one is supplied", async () => {
    const fetchMock = reply('{"name":"Rice","kcal":130}');
    vi.stubGlobal("fetch", fetchMock);
    const jsonSchema = { type: "object" };
    await provider().complete({ system: "s", prompt: "p", schema, jsonSchema });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).format).toEqual(jsonSchema);
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
