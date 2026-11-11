import type { ApiFetchFn } from "@bio-mcp/shared/codemode/catalog";
import {discoverBulk, fail, readText} from "./bulk";
import {joinBulk} from "./bulk-join";
import { nppesFetch } from "./http";

export function createNpiApiFetch(): ApiFetchFn {
    return async (request) => {
        if (request.path === "/bulk/releases") {
            if (request.method !== "GET" || request.body !== undefined) fail("Bulk release discovery requires GET without a body");
            return {status: 200, data: await discoverBulk(request.params ?? {})};
        }
        if (request.path === "/bulk/join") {
            if (request.method !== "POST" || Object.keys(request.params ?? {}).length) fail("Bulk join requires POST without query parameters");
            return {status: 200, data: await joinBulk(request.body)};
        }
        const paths = ["/providers/search", "/providers/lookup", "/providers/organizations", "/providers/by-specialty", "/providers/by-location"];
        if (request.method !== "GET" || request.body !== undefined || !paths.includes(request.path)) fail("Unknown NPI read operation");
        const params = {...request.params};
        if (params.exact_match !== undefined) fail("exact_match is not a documented NPPES parameter; use use_first_name_alias=false for exact first-name matching only");
        if (params.use_first_name_alias !== undefined) {
            if (typeof params.use_first_name_alias !== "boolean") fail("use_first_name_alias must be boolean");
            params.use_first_name_alias = params.use_first_name_alias ? "True" : "False";
        }
        if (request.path === "/providers/organizations") params.enumeration_type = "NPI-2";
        if (params.version !== undefined && params.version !== "2.1") fail("Registry API remains version 2.1; bulk V2 is separate");
        for (const [key, fallback, maximum] of [["limit", 10, 200], ["skip", 0, 1000]] as const) {
            const value = params[key] ?? fallback;
            if (!/^\d+$/.test(String(value)) || Number(value) < (key === "limit" ? 1 : 0) || Number(value) > maximum) fail(`Invalid ${key}`);
            params[key] = Number(value);
        }
        // nppesFetch auto-appends version=2.1
        const response = await nppesFetch("/", params);

        return await readNppesResponse(response);
    };
}

async function readNppesResponse(response: Response) {
  const raw = await readText(response, 4 * 1024 * 1024);
  let data: unknown;
  try { data = JSON.parse(raw); } catch { fail("Invalid NPPES JSON", 502, {response: raw, http_status: response.status, incomplete: true}); }
  if (!data || typeof data !== "object" || Array.isArray(data)) fail("Invalid NPPES response", 502, {response: raw, problem: data, http_status: response.status, incomplete: true});
  if ("Errors" in data) fail("NPPES returned query errors; refine the request", response.status, {response: raw, problem: data, http_status: response.status, incomplete: true});
  return {status: response.status, data};
}
