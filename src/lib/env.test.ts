import { describe, expect, it } from "vitest";
import { AI_BASE_URL_DEFAULT, AI_MODEL_DEFAULT, resolveAiBaseUrl, resolveAiModel } from "./env";

/**
 * The diagnostics page and the AI client used to read different variables, so a
 * green "Ollama" row could describe an instance nothing ever called. Both now
 * go through these two functions; these cases are what keep them agreeing.
 */
describe("AI endpoint resolution", () => {
  it("prefers the current AI_* spelling", () => {
    const source = { AI_BASE_URL: "http://gpu.lan:11434", OLLAMA_BASE_URL: "http://old:11434", AI_MODEL: "qwen3.5:4b", OLLAMA_MODEL: "deepseek-r1" };
    expect(resolveAiBaseUrl(source)).toBe("http://gpu.lan:11434");
    expect(resolveAiModel(source)).toBe("qwen3.5:4b");
  });

  it("still honours the superseded OLLAMA_* spelling on its own", () => {
    const source = { OLLAMA_BASE_URL: "http://gpu.lan:11434", OLLAMA_MODEL: "deepseek-r1" };
    expect(resolveAiBaseUrl(source)).toBe("http://gpu.lan:11434");
    expect(resolveAiModel(source)).toBe("deepseek-r1");
  });

  it("treats an empty or blank value as unset rather than as a configured host", () => {
    // Compose writes an empty string for an unset `${VAR:-}`; that must not
    // shadow the fallback and leave the client calling an empty base URL.
    expect(resolveAiBaseUrl({ AI_BASE_URL: "", OLLAMA_BASE_URL: "http://gpu.lan:11434" })).toBe("http://gpu.lan:11434");
    expect(resolveAiModel({ AI_MODEL: "   ", OLLAMA_MODEL: "deepseek-r1" })).toBe("deepseek-r1");
  });

  it("trims surrounding whitespace from a configured value", () => {
    expect(resolveAiBaseUrl({ AI_BASE_URL: " http://gpu.lan:11434 " })).toBe("http://gpu.lan:11434");
  });

  it("falls back to one shared default when nothing is configured", () => {
    expect(resolveAiBaseUrl({})).toBe(AI_BASE_URL_DEFAULT);
    expect(resolveAiModel({})).toBe(AI_MODEL_DEFAULT);
  });
});
