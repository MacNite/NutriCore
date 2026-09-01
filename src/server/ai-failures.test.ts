import { describe, expect, it } from "vitest";
import { AIInvalidOutputError, AIUnavailableError } from "@/providers/ai";
import { causeChain, describeFailure, isPermanentFailure } from "./ai-failures";

/** Reproduces what Node's fetch actually throws, cause chain included. */
const fetchFailure = (code: string, message: string) => {
  const inner = Object.assign(new Error(message), { code });
  return new TypeError("fetch failed", { cause: inner });
};

describe("AI failure classification", () => {
  it("names the real cause under a bare 'fetch failed'", () => {
    const error = new AIUnavailableError("ollama", "Ollama request failed", fetchFailure("ECONNREFUSED", "connect ECONNREFUSED 10.8.0.4:11434"));
    const described = describeFailure(error);

    expect(described.kind).toBe("MODEL_UNREACHABLE");
    expect(described.detail).toContain("ECONNREFUSED");
    // The short line stays what the log already showed, so nothing regresses.
    expect(described.message).toBe("Ollama request failed");
  });

  it("separates a request that ran out of time from one that found no route", () => {
    const timedOut = new AIUnavailableError(
      "ollama",
      "Ollama request failed",
      fetchFailure("UND_ERR_HEADERS_TIMEOUT", "Headers Timeout Error"),
    );
    expect(describeFailure(timedOut).kind).toBe("MODEL_TIMEOUT");

    const aborted = new AIUnavailableError("ollama", "Ollama request failed", Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" }));
    expect(describeFailure(aborted).kind).toBe("MODEL_TIMEOUT");
  });

  it("classifies a schema rejection as bad model output, not an outage", () => {
    const described = describeFailure(new AIInvalidOutputError("components.0.estimatedGrams: Too small: expected number to be >0"));
    expect(described.kind).toBe("MODEL_OUTPUT_INVALID");
    expect(described.permanent).toBe(false);
  });

  it("distinguishes the source-fetch failures from each other", () => {
    expect(describeFailure(new Error("source-too-large")).kind).toBe("SOURCE_TOO_LARGE");
    expect(describeFailure(new Error("unsafe-source:private-address")).kind).toBe("SOURCE_BLOCKED");
    expect(describeFailure(new Error("source-http-404")).kind).toBe("SOURCE_UNAVAILABLE");
    expect(describeFailure(new Error("Nutrition source search unavailable")).kind).toBe("SEARCH_UNAVAILABLE");
  });

  /**
   * The worker used to read one boolean through the full env schema, so a
   * deployment that gave APP_SECRET only to the web process failed every quick
   * meal - after the model call had already succeeded.
   */
  it("names a configuration problem instead of reporting it as unknown", () => {
    const described = describeFailure(
      new Error("Invalid environment configuration: APP_SECRET: Invalid input: expected string, received undefined"),
    );
    expect(described.kind).toBe("CONFIG_INVALID");
    // Retrying cannot change a missing setting.
    expect(described.permanent).toBe(true);
  });

  it("marks a reason that cannot change on a retry as permanent", () => {
    expect(isPermanentFailure("SOURCE_TOO_LARGE")).toBe(true);
    expect(isPermanentFailure("DATA_MISSING")).toBe(true);
    // A slow or restarting model is worth another attempt.
    expect(isPermanentFailure("MODEL_TIMEOUT")).toBe(false);
    expect(isPermanentFailure("MODEL_UNREACHABLE")).toBe(false);
  });

  it("reports an HTTP status from Ollama as its own kind", () => {
    expect(describeFailure(new AIUnavailableError("ollama", "Ollama responded with 500")).kind).toBe("MODEL_HTTP_ERROR");
  });

  it("survives a circular cause chain and a non-error throw", () => {
    const a = new Error("a") as Error & { cause?: unknown };
    const b = new Error("b") as Error & { cause?: unknown };
    a.cause = b;
    b.cause = a;
    expect(causeChain(a).length).toBe(2);
    expect(describeFailure("just a string").message).toBe("just a string");
    expect(describeFailure(undefined).message).toBe("AI processing failed");
  });
});
