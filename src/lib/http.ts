import type { RestFetchOptions } from "@bio-mcp/shared/http/rest-fetch";
import { restFetch } from "@bio-mcp/shared/http/rest-fetch";

const NPPES_BASE = "https://npiregistry.cms.hhs.gov/api";

export interface NppessFetchOptions extends Omit<RestFetchOptions, "retryOn"> {
    baseUrl?: string;
}

/**
 * Fetch from the CMS NPPES NPI Registry API v2.1.
 * No authentication required. Automatically appends version=2.1.
 */
export async function nppesFetch(
    path: string,
    params?: Record<string, unknown>,
    opts?: NppessFetchOptions,
): Promise<Response> {
    const baseUrl = opts?.baseUrl ?? NPPES_BASE;
    const headers: Record<string, string> = {
        Accept: "application/json",
        ...(opts?.headers ?? {}),
    };

    // Always include version=2.1
    const mergedParams = { ...params, version: "2.1" };

    return restFetch(baseUrl, path, mergedParams, {
        ...opts,
        headers,
        retryOn: [429, 500, 502, 503],
        retries: opts?.retries ?? 3,
        timeout: opts?.timeout ?? 30_000,
        userAgent: "npi-registry-mcp-server/1.0 (bio-mcp)",
    });
}
