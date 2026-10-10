import { Injectable, Logger } from '@nestjs/common';

/**
 * Provider-agnostic LLM client — OpenAI-compatible Chat Completions API.
 * Gemini, OpenAI, OpenRouter and Groq all expose this shape.
 *
 * Env:
 *   AI_PROVIDER  gemini (default) | openai | openrouter | groq | custom
 *   AI_API_KEY   required — service reports unconfigured without it
 *   AI_MODEL     optional override (defaults per provider)
 *   AI_BASE_URL  optional override (custom gateways/proxies)
 */
const PROVIDERS: Record<string, { baseUrl: string; model: string }> = {
  gemini: {
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    model: 'gemini-flash-latest', // alias tracks the current Flash generation
  },
  openai: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  openrouter: {
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'google/gemini-2.0-flash-001',
  },
  groq: { baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.1-8b-instant' },
};

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  private get apiKey(): string | undefined {
    // AI_API_KEY wins; the Gemini preset also accepts the existing
    // GOOGLE_GENERATIVE_AI_API_KEY env so a second key isn't needed
    return process.env.AI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  }

  get configured(): boolean {
    return !!this.apiKey;
  }

  private get provider() {
    const preset = PROVIDERS[(process.env.AI_PROVIDER ?? 'gemini').toLowerCase()] ?? PROVIDERS.gemini!;
    return {
      baseUrl: (process.env.AI_BASE_URL ?? preset.baseUrl).replace(/\/$/, ''),
      model: process.env.AI_MODEL ?? preset.model,
    };
  }

  /**
   * Single-turn completion. Returns null on any failure (timeout, HTTP error,
   * malformed body) — callers always have a graceful fallback.
   */
  /**
   * Single-turn completion. Returns null on any failure (timeout, HTTP error,
   * malformed body) — callers always have a graceful fallback.
   * Retries transient provider errors (429 rate limit / 503 overload) with
   * short backoff — the free tier fluctuates minute to minute.
   */
  async complete(opts: { system: string; user: string; maxTokens?: number; timeoutMs?: number }): Promise<string | null> {
    if (!this.configured) return null;
    const { baseUrl, model } = this.provider;
    for (let attempt = 0; attempt < 3; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);
      try {
        const res = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model,
            temperature: 0.2, // grounded Q&A — accuracy over creativity
            // thinking models burn completion budget on reasoning — keep headroom
            max_tokens: opts.maxTokens ?? 800,
            messages: [
              { role: 'system', content: opts.system },
              { role: 'user', content: opts.user },
            ],
          }),
          signal: controller.signal,
        });
        if (res.ok) {
          const data: any = await res.json();
          const text: string | undefined = data?.choices?.[0]?.message?.content?.trim();
          return text || null;
        }
        if ((res.status === 429 || res.status === 503) && attempt < 2) {
          // Daily-quota 429s carry a long RetryInfo delay — fail fast instead of retrying
          if (res.status === 429) {
            const body: any = await res.clone().json().catch(() => null);
            const retryAfter = body?.error?.details?.find((d: any) => d['@type']?.includes('RetryInfo'))?.retryDelay;
            const seconds = retryAfter ? parseInt(retryAfter, 10) : 0;
            if (seconds > 120) {
              this.logger.warn(`AI quota exhausted (retry in ${Math.round(seconds / 60)}min) — failing fast`);
              return null;
            }
          }
          this.logger.warn(`AI transient HTTP ${res.status} — retry ${attempt + 1}/2`);
          await new Promise((r) => setTimeout(r, 2000 + attempt * 4000));
          continue;
        }
        this.logger.warn(`AI call failed: HTTP ${res.status} (${model})`);
        return null;
      } catch (err) {
        this.logger.warn(`AI call error: ${(err as Error).message}`);
        return null; // timeouts/network — don't retry, callers fall back
      } finally {
        clearTimeout(timeout);
      }
    }
    return null;
  }
}
