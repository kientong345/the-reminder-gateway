import { Env } from "./types";
import { CacheProvider, createCacheProvider } from "./cache_provider";

const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.readonly";

export interface OAuthTokens {
    access_token: string;
    refresh_token?: string;
    expires_in: number;
    scope?: string;
    token_type: string;
}

interface CachedTokenPayload {
    accessToken: string;
    expiresAt: number;
}

export function buildGoogleAuthUrl(clientId: string, redirectUri: string): string {
    const url = new URL(GOOGLE_AUTH_ENDPOINT);
    url.searchParams.set("client_id", clientId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", CALENDAR_SCOPE);
    url.searchParams.set("access_type", "offline");
    url.searchParams.set("prompt", "consent");
    return url.toString();
}

export async function exchangeCodeForTokens(
    clientId: string,
    clientSecret: string,
    code: string,
    redirectUri: string
): Promise<OAuthTokens> {
    const resp = await fetch(GOOGLE_TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            code,
            client_id: clientId,
            client_secret: clientSecret,
            redirect_uri: redirectUri,
            grant_type: "authorization_code"
        })
    });

    if (!resp.ok) {
        throw new Error(`Google OAuth code exchange thất bại (${resp.status}): ${await resp.text()}`);
    }

    return (await resp.json()) as OAuthTokens;
}

export async function getGoogleAccessToken(
    clientId: string,
    clientSecret: string,
    refreshToken: string,
    cache: CacheProvider = createCacheProvider()
): Promise<string> {
    const hit = await cache.getJson<CachedTokenPayload>("gcal/oauth-token");
    if (hit && hit.expiresAt > Date.now()) {
        return hit.accessToken;
    }

    const resp = await fetch(GOOGLE_TOKEN_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
            client_id: clientId,
            client_secret: clientSecret,
            refresh_token: refreshToken,
            grant_type: "refresh_token"
        })
    });

    if (!resp.ok) {
        throw new Error(`Google OAuth refresh thất bại (${resp.status}): ${await resp.text()}`);
    }

    const tokenData = (await resp.json()) as OAuthTokens;
    const expiresIn = typeof tokenData.expires_in === "number" ? tokenData.expires_in : 3600;
    const ttlSec = Math.max(60, expiresIn - 60);

    const payload: CachedTokenPayload = {
        accessToken: tokenData.access_token,
        expiresAt: Date.now() + ttlSec * 1000
    };

    await cache.putJson("gcal/oauth-token", payload, ttlSec);
    return payload.accessToken;
}

export async function handleOAuthRequest(request: Request, url: URL, env: Env): Promise<Response | null> {
    const redirectUri = `${url.origin}/oauth/callback`;

    if (url.pathname === "/oauth/login" && request.method === "GET") {
        return Response.redirect(buildGoogleAuthUrl(env.GOOGLE_CLIENT_ID, redirectUri), 302);
    }

    if (url.pathname === "/oauth/callback" && request.method === "GET") {
        const error = url.searchParams.get("error");
        if (error) {
            return Response.json({ error }, { status: 400 });
        }

        const code = url.searchParams.get("code");
        if (!code) {
            return Response.json({ error: "Missing authorization code" }, { status: 400 });
        }

        const tokens = await exchangeCodeForTokens(
            env.GOOGLE_CLIENT_ID,
            env.GOOGLE_CLIENT_SECRET,
            code,
            redirectUri
        );

        return Response.json({
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token,
            expires_in: tokens.expires_in,
            scope: tokens.scope
        });
    }

    return null;
}
