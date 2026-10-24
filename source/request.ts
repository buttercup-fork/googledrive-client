import URL from "url-parse";
import { Layerr } from "layerr";
import { Headers } from "./types.js";

export interface RequestConfig {
    body?: string | Buffer | ArrayBufferLike;
    headers?: Headers;
    method: "DELETE" | "GET" | "HEAD" | "PATCH" | "POST";
    query?: Record<string, string>;
    /**
     * Milliseconds to wait for the response, 0 for no limit
     */
    timeout?: number;
    url: string;
}

export function handleBadResponse(response: Response): void {
    if (!response.ok) {
        const error = new Layerr(
            {
                info: {
                    status: response.status,
                    statusText: response.statusText,
                    url: response.url
                }
            },
            `Request failed: ${response.status} ${response.statusText}`
        );
        if (response.headers.get("www-authenticate")) {
            throw new Layerr(
                {
                    cause: error,
                    info: {
                        authFailure: /error=(")?invalid_token/.test(
                            response.headers.get("www-authenticate")
                        )
                    }
                },
                "Bad authentication"
            );
        }
        throw error;
    }
}

export async function request(config: RequestConfig): Promise<Response> {
    const url = new URL(config.url);
    if (config.query) {
        const newQuery = Object.assign(url.query || {}, config.query);
        url.set("query", newQuery);
    }
    const { signal, clear } = timeoutSignal(config.timeout);
    try {
        return await fetch(url.toString(), {
            method: config.method,
            headers: config.headers,
            signal,
            // @ts-ignore
            body: config.body
        });
    } finally {
        clear();
    }
}

/**
 * Create an abort signal that fires after a timeout. It covers sending the
 * request and waiting for the response, not reading the response body.
 * @param timeout Milliseconds (0 or none for no limit)
 */
export function timeoutSignal(timeout?: number): {
    signal: AbortSignal | undefined;
    clear: () => void;
} {
    if (!timeout || timeout <= 0) return { signal: undefined, clear: () => {} };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    return { signal: controller.signal, clear: () => clearTimeout(timer) };
}

/**
 * Whether a request uploads or downloads file contents (vaults and
 * attachments), which gets the longer time limit
 */
export function isContentRequest(config: RequestConfig): boolean {
    const url = new URL(config.url, true);
    return (
        url.pathname.startsWith("/upload/") ||
        config.query?.alt === "media" ||
        url.query.alt === "media"
    );
}
