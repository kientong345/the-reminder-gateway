export interface CacheProvider {
    getJson<T>(key: string): Promise<T | null>;
    putJson<T>(key: string, data: T, ttlSec?: number): Promise<void>;
    getResponse(key: string): Promise<Response | null>;
    putResponse(key: string, response: Response): Promise<void>;
}

export class CloudflareCacheAdapter implements CacheProvider {
    private cache?: Cache;

    constructor(cache: Cache | undefined = (caches as any)?.default) {
        this.cache = cache;
    }

    private toReq(key: string): Request {
        return new Request(`https://internal.cache/${key.replace(/^\/+/, "")}`);
    }

    async getJson<T>(key: string): Promise<T | null> {
        if (!this.cache) return null;
        const hit = await this.cache.match(this.toReq(key));
        if (!hit) return null;
        return (await hit.json()) as T;
    }

    async putJson<T>(key: string, data: T, ttlSec = 86400): Promise<void> {
        if (!this.cache) return;
        await this.cache.put(
            this.toReq(key),
            new Response(JSON.stringify(data), {
                headers: {
                    "Content-Type": "application/json",
                    "Cache-Control": `public, max-age=${ttlSec}`
                }
            })
        );
    }

    async getResponse(key: string): Promise<Response | null> {
        if (!this.cache) return null;
        const hit = await this.cache.match(this.toReq(key));
        return hit || null;
    }

    async putResponse(key: string, response: Response): Promise<void> {
        if (!this.cache) return;
        await this.cache.put(this.toReq(key), response);
    }
}

export function createCacheProvider(): CacheProvider {
    return new CloudflareCacheAdapter();
}
