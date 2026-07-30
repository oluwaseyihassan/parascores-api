import { Injectable, Logger } from '@nestjs/common';
import { ResponseUtil } from 'src/utils/api-response';

interface NominatimResult {
  name?: string;
  display_name: string;
  lat?: string;
  lon?: string;
  address?: {
    city?: string;
    town?: string;
    village?: string;
    suburb?: string;
    state?: string;
  };
}

export interface LocationSuggestion {
  label: string;
  lat: number | null;
  lon: number | null;
}

interface CachedResult {
  at: number;
  items: LocationSuggestion[];
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 500;

@Injectable()
export class LocationsService {
  private readonly logger = new Logger(LocationsService.name);
  private readonly cache = new Map<string, CachedResult>();

  async search(query: string) {
    const term = (query || '').trim();
    if (term.length < 3) {
      return ResponseUtil.success([]);
    }

    const cacheKey = term.toLowerCase();
    const cached = this.cache.get(cacheKey);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return ResponseUtil.success(cached.items);
    }

    try {
      const params = new URLSearchParams({
        format: 'jsonv2',
        countrycodes: 'ng',
        addressdetails: '1',
        namedetails: '1',
        limit: '10',
        q: term,
      });

      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?${params.toString()}`,
        {
          headers: {
            'User-Agent': 'ParaScores (https://parascores.com)',
            'Accept-Language': 'en',
          },
        },
      );

      if (!res.ok) {
        this.logger.warn(`Nominatim returned ${res.status}`);
        return ResponseUtil.success([]);
      }

      const results = (await res.json()) as NominatimResult[];
      const items = this.formatResults(results);

      this.setCache(cacheKey, items);

      return ResponseUtil.success(items);
    } catch (error: any) {
      this.logger.warn(`Nominatim search failed: ${error?.message}`);
      return ResponseUtil.success([]);
    }
  }

  private formatResults(results: NominatimResult[]): LocationSuggestion[] {
    const seen = new Set<string>();
    const items: LocationSuggestion[] = [];

    for (const result of results) {
      const addr = result.address;
      const city =
        addr?.city || addr?.town || addr?.village || addr?.suburb;

      const parts: string[] = [];
      const specific =
        result.name || result.display_name?.split(',')[0]?.trim();

      if (specific && specific.toLowerCase() !== city?.toLowerCase()) {
        parts.push(specific);
      }
      if (city && !parts.some((p) => p.toLowerCase() === city.toLowerCase())) {
        parts.push(city);
      }
      if (addr?.state) {
        parts.push(addr.state);
      }

      let label: string | null = parts.length ? parts.join(', ') : null;
      if (!label && result.display_name) {
        label = result.display_name
          .split(',')
          .slice(0, 3)
          .map((part) => part.trim())
          .filter(Boolean)
          .join(', ');
      }

      if (label && !seen.has(label)) {
        seen.add(label);
        items.push({
          label,
          lat: result.lat ? Number(result.lat) : null,
          lon: result.lon ? Number(result.lon) : null,
        });
      }
    }

    return items;
  }

  private setCache(key: string, items: LocationSuggestion[]) {
    if (this.cache.size >= CACHE_MAX_ENTRIES) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) this.cache.delete(oldestKey);
    }
    this.cache.set(key, { at: Date.now(), items });
  }
}
