import { z } from "zod";

const responseSchema = z.object({ results: z.array(z.object({ title: z.string(), url: z.string().url(), content: z.string().optional() })).max(20) });
export type SearchSource = { title: string; url: string; excerpt?: string };

export function sanitizeSearchQuery(query: string) { return query.replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 180); }

export class SearxngClient {
  constructor(private baseUrl = process.env.SEARXNG_URL, private timeoutMs = Number(process.env.SEARXNG_TIMEOUT_MS ?? 5000)) {}
  async search(query: string): Promise<SearchSource[]> {
    if (!this.baseUrl) return [];
    const url = new URL("/search", this.baseUrl); url.searchParams.set("q", sanitizeSearchQuery(query)); url.searchParams.set("format", "json");
    let last: unknown;
    for (let attempt=0; attempt<2; attempt++) try {
      const response=await fetch(url,{headers:{Accept:"application/json"},signal:AbortSignal.timeout(this.timeoutMs)});
      if(!response.ok) throw new Error(`SearXNG responded with ${response.status}`);
      return responseSchema.parse(await response.json()).results.slice(0,5).map(r=>({title:r.title,url:r.url,excerpt:r.content}));
    } catch(error) { last=error; if(attempt===0) await new Promise(resolve=>setTimeout(resolve,150)); }
    throw new Error("Nutrition source search unavailable", {cause:last});
  }
}
