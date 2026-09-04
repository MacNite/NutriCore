import { prisma } from "@/lib/db";
import { env, hasSecret } from "@/lib/env";
import { OllamaProvider } from "@/providers/ollama";
import { userAgentLooksAnonymous } from "@/providers/open-food-facts";
import { AIUnavailableError } from "@/providers/ai";
import { SearxngClient } from "@/providers/searxng";
import { FatSecretProvider } from "@/providers/fatsecret";
import { ProviderUnavailableError } from "@/providers/food";
import { DATASET_KEYS } from "./food-datasets/import";

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
        status: await timed(() => probe(`${config.AI_BASE_URL}/api/tags`)),
        detail: safeHost(config.AI_BASE_URL),
      }
    : { key: "ollama", status: "disabled" };

  // Ask the adapter whether the configured model is actually installed, rather
  // than reporting the configured name as if it were a successful check.
  const model: Check = config.AI_ENABLED
    ? await (async (): Promise<Check> => {
        if (ollama.status !== "ok") {
          return { key: "model", status: "unknown", detail: config.AI_MODEL };
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
                ? `${config.AI_MODEL} — not installed on this Ollama instance`
                : config.AI_MODEL,
          };
        }
      })()
    : { key: "model", status: "disabled" };

  // The web process can reach Ollama even when no worker process is running.
  // Surface that distinction: an old queued job is a reliable indication that
  // the separately deployed worker is not consuming the queue.
  const aiWorker: Check = config.AI_ENABLED
    ? await (async (): Promise<Check> => {
        const oldest = await prisma.aiJob.findFirst({
          where: { status: "QUEUED" },
          orderBy: { createdAt: "asc" },
          select: { createdAt: true },
        });
        if (!oldest) return { key: "aiWorker", status: "unknown", detail: "no queued jobs" };
        const queuedSeconds = Math.max(0, Math.floor((Date.now() - oldest.createdAt.getTime()) / 1000));
        return queuedSeconds > 30
          ? { key: "aiWorker", status: "error", detail: `oldest job queued for ${formatDuration(queuedSeconds)}` }
          : { key: "aiWorker", status: "unknown", detail: `job queued for ${formatDuration(queuedSeconds)}` };
      })()
    : { key: "aiWorker", status: "disabled" };

  // Text search and barcode lookup run on separate infrastructure and fail
  // independently, so a single "Open Food Facts" row cannot say which is down.
  const openFoodFactsSearch: Check = config.OPENFOODFACTS_ENABLED
    ? config.OPENFOODFACTS_SEARCH_BACKEND === "legacy"
      ? { key: "openFoodFactsSearch", status: "unknown", detail: "pinned to the legacy /cgi/search.pl endpoint" }
      : {
          key: "openFoodFactsSearch",
          status: await timed(() => probe(`${config.OPENFOODFACTS_SEARCH_URL}/health`)),
          detail: safeHost(config.OPENFOODFACTS_SEARCH_URL),
        }
    : { key: "openFoodFactsSearch", status: "disabled" };

  // The most common cause of Open Food Facts errors on a fresh install: the
  // service blocks callers that do not identify themselves with a contact.
  const openFoodFactsIdentity: Check = config.OPENFOODFACTS_ENABLED
    ? userAgentLooksAnonymous(config.OPENFOODFACTS_USER_AGENT)
      ? { key: "openFoodFactsUserAgent", status: "error", detail: "set OPENFOODFACTS_USER_AGENT to an app name and contact address" }
      : { key: "openFoodFactsUserAgent", status: "ok", detail: config.OPENFOODFACTS_USER_AGENT }
    : { key: "openFoodFactsUserAgent", status: "disabled" };

  // The bundled food databases: whether they are imported, not whether they
  // are configured. An enabled source with nothing imported is the one failure
  // mode a deployment actually hits, and it is fixed by one command.
  const imports = await prisma.datasetImport.findMany({ select: { key: true, version: true, recordCount: true } });
  const importedBy = new Map(imports.map((row) => [row.key, row]));
  const bundled = (key: string, enabled: boolean, label: string): Check => {
    if (!enabled) return { key, status: "disabled" };
    const rows = DATASET_KEYS.filter((dataset) => dataset === label || dataset.startsWith(`${label}-`)).map((dataset) =>
      importedBy.get(dataset),
    );
    const present = rows.filter((row) => row && row.recordCount > 0);
    if (present.length === 0) {
      return { key, status: "error", detail: "bundled but not imported — run `npm run db:import:foods`" };
    }
    const foods = present.reduce((total, row) => total + (row?.recordCount ?? 0), 0);
    return { key, status: "ok", detail: `${foods.toLocaleString("en-US")} foods — ${present[0]?.version ?? ""}`.trim() };
  };

  const bls = bundled("bls", config.BLS_ENABLED, "bls");

  // Two capabilities behind one switch: the bundled releases, which always
  // work, and the FoodData Central API, which needs a key. Reported together
  // so "USDA" cannot look broken merely because no key is configured.
  const usda: Check = !config.USDA_ENABLED
    ? { key: "usda", status: "disabled" }
    : await (async (): Promise<Check> => {
        const local = bundled("usda", true, "usda");
        if (!hasSecret("USDA_API_KEY")) {
          return local.status === "ok"
            ? { key: "usda", status: "ok", detail: `${local.detail} — bundled only, no API key` }
            : { key: "usda", status: local.status, detail: local.detail };
        }
        const reachable = await timed(() => probe(`${config.USDA_BASE_URL}/foods/search?query=apple&pageSize=1&api_key=${encodeURIComponent(config.USDA_API_KEY ?? "")}`));
        return {
          key: "usda",
          status: reachable === "ok" ? "ok" : "error",
          detail:
            reachable === "ok"
              ? `${local.detail} — API reachable`
              : `${local.detail} — API unreachable or key rejected`,
        };
      })();

  /**
   * FatSecret, including the mistake a self-hosted deployment actually makes.
   *
   * The Platform API authorises by IP address, so credentials that are
   * perfectly valid are refused from an unregistered address. Reporting that
   * as "error: check the IP allowlist" is the difference between a five-minute
   * fix and an afternoon.
   */
  const fatSecret: Check = !config.FATSECRET_ENABLED
    ? { key: "fatSecret", status: "disabled" }
    : !hasSecret("FATSECRET_CLIENT_ID") || !hasSecret("FATSECRET_CLIENT_SECRET")
      ? { key: "fatSecret", status: "error", detail: "enabled but FATSECRET_CLIENT_ID/SECRET are not set" }
      : await (async (): Promise<Check> => {
          try {
            const results = await new FatSecretProvider().search("apple", { limit: 1 });
            return {
              key: "fatSecret",
              status: "ok",
              detail: `${results.length > 0 ? "answering" : "reachable, no result"}${config.FATSECRET_REGION ? ` — region ${config.FATSECRET_REGION}` : ""}`,
            };
          } catch (error) {
            const detail =
              error instanceof ProviderUnavailableError && error.message.includes("IP address")
                ? "this deployment's outbound IP address is not registered with the FatSecret account"
                : error instanceof ProviderUnavailableError
                  ? error.reason.toLowerCase()
                  : "unreachable";
            return { key: "fatSecret", status: "error", detail };
          }
        })();

  // SearXNG is the implemented source-discovery provider. RESEARCH_PROVIDER is
  // reserved for a future provider API and must not make a configured SearXNG
  // instance appear as "not selected".
  const research: Check = config.SEARXNG_URL
    ? {
        key: "research",
        status: await timed(async () => {
          await new SearxngClient(config.SEARXNG_URL, config.SEARXNG_TIMEOUT_MS).search("nutrition");
          return true;
        }),
        detail: `SearXNG — ${safeHost(config.SEARXNG_URL)}`,
      }
    : { key: "research", status: "disabled", detail: "SEARXNG_URL not configured" };

  return [database, ollama, model, aiWorker, bls, openFoodFacts, openFoodFactsSearch, openFoodFactsIdentity, usda, fatSecret, research];
}

const formatDuration = (seconds: number) =>
  seconds < 60 ? `${seconds}s` : seconds < 3600 ? `${Math.floor(seconds / 60)}m` : `${Math.floor(seconds / 3600)}h`;

const safeHost = (value: string) => {
  try {
    return new URL(value).host;
  } catch {
    return "invalid URL";
  }
};
