import { Env } from "./types";
import { createCacheProvider } from "./cache_provider";
import { createScheduleProvider } from "./schedule_provider";
import { getTodayWindow, computeVersionHash, toCompactSchedule, getPollIntervalSec } from "./utils";
import { createLLMProvider } from "./llm_provider";
import { createTTSProvider } from "./tts_provider";
import { handleOAuthRequest } from "./oauth";

function isAuthorized(request: Request, url: URL, env: Env): boolean {
    if (!env.DEVICE_AUTH_TOKEN) return true;
    const authHeader = request.headers.get("Authorization");
    const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : authHeader?.trim();
    const token = url.searchParams.get("token") || bearer;
    return token === env.DEVICE_AUTH_TOKEN;
}

export default {
    async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
        const url = new URL(request.url);
        const cacheProvider = createCacheProvider();

        if (url.pathname === "/health") {
            return Response.json({ status: "healthy", timestamp: Date.now() });
        }

        const oauthResp = await handleOAuthRequest(request, url, env);
        if (oauthResp) return oauthResp;

        if (url.pathname === "/poll" && request.method === "GET") {
            if (!isAuthorized(request, url, env)) {
                return new Response("Unauthorized", { status: 403 });
            }

            const nowMs = Date.now();
            const nowSec = Math.floor(nowMs / 1000);
            const pollAfterSec = getPollIntervalSec(nowMs);
            const provider = createScheduleProvider(env, cacheProvider);
            const events = await provider.getSchedule(getTodayWindow(nowMs));
            const active = events
                .filter(e => e.status !== "cancelled")
                .sort((a, b) => a.start_time - b.start_time);

            const version = computeVersionHash(active);
            const clientVersion = url.searchParams.get("version") || "";

            if (clientVersion && clientVersion === version) {
                return Response.json({
                    changed: false,
                    version,
                    server_time: nowSec,
                    poll_after_sec: pollAfterSec
                });
            }

            const compactEvents = toCompactSchedule(active, 0);
            let currentIdx = compactEvents.findIndex(e => e.remind_ts >= nowSec);
            if (currentIdx === -1 && compactEvents.length > 0) {
                currentIdx = compactEvents.length;
            }

            return Response.json({
                changed: true,
                version,
                server_time: nowSec,
                poll_after_sec: pollAfterSec,
                current_idx: currentIdx < 0 ? 0 : currentIdx,
                events: compactEvents
            });
        }

        if (url.pathname === "/audio" && request.method === "GET") {
            if (!isAuthorized(request, url, env)) {
                return new Response("Unauthorized", { status: 403 });
            }

            const target = url.searchParams.get("target") === "today" ? "today" : "next";
            const nowMs = Date.now();
            const nowSec = Math.floor(nowMs / 1000);
            const scheduleProvider = createScheduleProvider(env, cacheProvider);
            const llmProvider = createLLMProvider(env);
            const ttsProvider = createTTSProvider();

            const events = await scheduleProvider.getSchedule(getTodayWindow(nowMs));
            const active = events
                .filter(e => e.status !== "cancelled")
                .sort((a, b) => a.start_time - b.start_time);

            const version = url.searchParams.get("version") || computeVersionHash(active);
            const compactEvents = toCompactSchedule(active, 0);
            const defaultIdx = compactEvents.findIndex(e => e.remind_ts >= nowSec);
            const idxParam = url.searchParams.get("idx");
            const idx = idxParam !== null ? parseInt(idxParam, 10) : (defaultIdx === -1 ? active.length : defaultIdx);

            const cacheKey = `audio/${version}/${target}/${target === "today" ? "all" : idx}`;
            const cachedAudio = await cacheProvider.getResponse(cacheKey);
            if (cachedAudio) return cachedAudio;

            const speech =
                target === "today"
                    ? await llmProvider.formatReminderSpeech(active, "list")
                    : idx >= 0 && idx < active.length
                      ? await llmProvider.formatReminderSpeech([active[idx]], "next")
                      : await llmProvider.formatReminderSpeech([], "next");

            const mp3Bytes = await ttsProvider.synthesize(speech);
            const response = new Response(mp3Bytes, {
                headers: {
                    "Content-Type": "audio/mpeg",
                    "Content-Length": String(mp3Bytes.byteLength),
                    "X-Version": version,
                    "X-Speech-Text": encodeURIComponent(speech),
                    "Cache-Control": "public, max-age=86400"
                }
            });

            ctx.waitUntil(cacheProvider.putResponse(cacheKey, response.clone()));
            return response;
        }

        return new Response("Not Found", { status: 404 });
    }
} satisfies ExportedHandler<Env>;
