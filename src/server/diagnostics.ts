import { prisma } from "@/lib/db";
import { env, hasSecret } from "@/lib/env";
import { OllamaProvider } from "@/providers/ollama";
import { userAgentLooksAnonymous } from "@/providers/open-food-facts";
import { AIUnavailableError } from "@/providers/ai";

export type CheckStatus = "ok" | "error" | "disabled" | "unknown";

export interface Check {
  key: string;
  status: CheckStatus;
  /** Non-secret detail only: a model name, a host, a latency. Never a key. */
  detail?: string;
}

async function timed(check: () => Promise<boolean>, detail?: string): Promise<Check["status"]> {
  try {
    return (await check()) ? "ok" : "error";
  } catch {
    return "error";
  } finally {
    void detail;
  }
}

const probe = async (url: string, timeoutMs = 4000) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  return response.ok;
};

/**
 * Reports reachability of every configured service. Secret values are never
 * included - only whether a secret is present at all.
 */
export async function runDiagnostics(): Promise<Check[]> {
  const config = env();

  const database: Check = {
    key: "database",
    status: await timed(async () => {
      await prisma.$queryRaw`SELECT 1`;
      return true;
    }),
  };

  const openFoodFacts: Check = config.OPENFOODFACTS_ENABLED
    ? {
        key: "openFoodFacts",
        status: await timed(() => probe(`${config.OPENFOODFACTS_BASE_URL}/api/v2/product/3017620422003.json?fields=code`)),
        detail: new URL(config.OPENFOODFACTS_BASE_URL).host,
      }
    : { key: "openFoodFacts", status: "disabled" };

  const ollama: Check = config.AI_ENABLED
    ? {
        key: "ollama",
        status: await timed(() => probe(`${config.OLLAMA_BASE_URL}/api/tags`)),
        detail: safeHost(config.OLLAMA_BASE_URL),
      }
    : { key: "ollama", status: "disabled" };

  // Ask the adapter whether the configured model is actually installed, rather
  // than reporting the configured name as if it were a successful check.
  const model: Check = config.AI_ENABLED
    ? await (async (): Promise<Check> => {
        if (ollama.status !== "ok") {
          return { key: "model", status: "unknown", detail: config.OLLAMA_MODEL };
        }
        try {
          const capabilities = await new OllamaProvider().capabilities();
          return { key: "model", status: "ok", detail: capabilities.model };
        } catch (error) {
          return {
            key: "model",
            status: "error",
            detail:
              error instanceof AIUnavailableError
                ? `${config.OLLAMA_MODEL} — not installed on this Ollama instance`
                : config.OLLAMA_MODEL,
          };
        }
      })()
    : { key: "model", status: "disabled" };

  // The most common cause of Open Food Facts errors on a fresh install: the
  // service blocks callers that do not identify themselves with a contact.
  const openFoodFactsIdentity: Check = config.OPENFOODFACTS_ENABLED
    ? userAgentLooksAnonymous(config.OPENFOODFACTS_USER_AGENT)
      ? { key: "openFoodFactsUserAgent", status: "error", detail: "set OPENFOODFACTS_USER_AGENT to an app name and contact address" }
      : { key: "openFoodFactsUserAgent", status: "ok", detail: config.OPENFOODFACTS_USER_AGENT }
    : { key: "openFoodFactsUserAgent", status: "disabled" };

  const usda: Check = config.USDA_ENABLED
    ? {
        key: "usda",
        // Phase 2: the adapter is designed but not implemented, so this only
        // reports whether the credential is present.
        status: hasSecret("USDA_API_KEY") ? "unknown" : "error",
        detail: hasSecret("USDA_API_KEY") ? "key configured" : "key missing",
      }
    : { key: "usda", status: "disabled" };

  const research: Check = config.RESEARCH_ENABLED
    ? { key: "research", status: "unknown", detail: config.RESEARCH_PROVIDER || "not selected" }
    : { key: "research", status: "disabled" };

  return [database, ollama, model, openFoodFacts, openFoodFactsIdentity, usda, research];
}

const safeHost = (value: string) => {
  try {
    return new URL(value).host;
  } catch {
    return "invalid URL";
  }
};
