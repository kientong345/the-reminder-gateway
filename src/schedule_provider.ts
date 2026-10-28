import { CalendarEventRecord, Env } from "./types";
import { CacheProvider, createCacheProvider } from "./cache_provider";
import { getGoogleAccessToken } from "./oauth";

export interface DateRange {
    start: number;
    end: number;
}

export interface ScheduleProvider {
    getSchedule(range?: DateRange | null): Promise<CalendarEventRecord[]>;
}

export interface GoogleScheduleAdapterConfig {
    clientId: string;
    clientSecret: string;
    refreshToken: string;
    cache?: CacheProvider;
}

interface CachedSchedulePayload {
    etag: string | null;
    fetchedAt: number;
    events: CalendarEventRecord[];
}

export class GoogleScheduleAdapter implements ScheduleProvider {
    private clientId: string;
    private clientSecret: string;
    private refreshToken: string;
    private cache: CacheProvider;

    constructor(config: GoogleScheduleAdapterConfig) {
        this.clientId = config.clientId;
        this.clientSecret = config.clientSecret;
        this.refreshToken = config.refreshToken;
        this.cache = config.cache || createCacheProvider();
    }

    private getAccessToken(): Promise<string> {
        return getGoogleAccessToken(
            this.clientId,
            this.clientSecret,
            this.refreshToken,
            this.cache
        );
    }

    async getSchedule(range?: DateRange | null): Promise<CalendarEventRecord[]> {
        const rangeKey = range ? `gcal/${range.start}-${range.end}` : "gcal/all";
        const cached = await this.cache.getJson<CachedSchedulePayload>(rangeKey);

        if (cached && Date.now() - cached.fetchedAt < 60_000) {
            return cached.events;
        }

        const accessToken = await this.getAccessToken();
        const now = Date.now();
        const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
        url.searchParams.set("singleEvents", "true");
        url.searchParams.set("orderBy", "startTime");
        url.searchParams.set("fields", "etag,items(id,summary,description,location,start,end,status)");
        if (range) {
            url.searchParams.set("timeMin", new Date(range.start).toISOString());
            url.searchParams.set("timeMax", new Date(range.end).toISOString());
        }

        const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}` };
        if (cached?.etag) headers["If-None-Match"] = cached.etag;

        const resp = await fetch(url.toString(), { headers });
        if (resp.status === 304 && cached?.events) {
            await this.cache.putJson(rangeKey, { etag: cached.etag, fetchedAt: now, events: cached.events }, 86400);
            return cached.events;
        }

        if (!resp.ok) {
            throw new Error(`Lỗi tải lịch primary (${resp.status}): ${await resp.text()}`);
        }

        const data: any = await resp.json();
        const events: CalendarEventRecord[] = (data.items || [])
            .filter((item: any) => item.status !== "cancelled")
            .map((item: any) => ({
                id: item.id,
                title: item.summary || "(Không có tiêu đề)",
                description: item.description || "",
                location: item.location || "",
                start_time: Date.parse(item.start?.dateTime || `${item.start?.date}T00:00:00Z`),
                end_time: Date.parse(item.end?.dateTime || `${item.end?.date}T23:59:59Z`),
                is_all_day: item.start?.dateTime ? 0 : 1,
                status: item.status || "confirmed",
                updated_at: now
            }));

        await this.cache.putJson(rangeKey, { etag: data.etag || null, fetchedAt: now, events }, 86400);
        return events;
    }
}

export function createScheduleProvider(
    env: Env,
    cache: CacheProvider = createCacheProvider()
): ScheduleProvider {
    return new GoogleScheduleAdapter({
        clientId: env.GOOGLE_CLIENT_ID,
        clientSecret: env.GOOGLE_CLIENT_SECRET,
        refreshToken: env.GOOGLE_REFRESH_TOKEN,
        cache
    });
}
