import type { ApiFetchFn } from "@bio-mcp/shared/codemode/catalog";
import { nppesFetch } from "./http";

export function createNpiApiFetch(): ApiFetchFn {
    return async (request) => {
        // The NPPES API is a single endpoint at the root (/)
        // All virtual catalog paths map to the same root with different query params.
        // Strip any virtual path prefix — everything goes to /
        let params = { ...request.params };

        const path = request.path;

        // /providers/lookup?number=... → /?number=...
        if (path.startsWith("/providers/lookup")) {
            // params already contains number, pass through
        }
        // /providers/organizations?organization_name=... → /?enumeration_type=NPI-2&organization_name=...
        else if (path.startsWith("/providers/organizations")) {
            params = { enumeration_type: "NPI-2", ...params };
        }
        // /providers/by-specialty?taxonomy_description=... → /?taxonomy_description=...
        else if (path.startsWith("/providers/by-specialty")) {
            // params already contains taxonomy_description, pass through
        }
        // /providers/by-location?state=...&city=... → /?state=...&city=...
        else if (path.startsWith("/providers/by-location")) {
            // params already contains location filters, pass through
        }
        // /providers/search or any other path — pass through all params
        // Default: just forward params as-is

        // nppesFetch auto-appends version=2.1
        const response = await nppesFetch("/", params);

        if (!response.ok) {
            let errorBody: string;
            try {
                errorBody = await response.text();
            } catch {
                errorBody = response.statusText;
            }
            const error = new Error(`HTTP ${response.status}: ${errorBody.slice(0, 200)}`) as Error & {
                status: number;
                data: unknown;
            };
            error.status = response.status;
            error.data = errorBody;
            throw error;
        }

        const contentType = response.headers.get("content-type") || "";
        if (!contentType.includes("json")) {
            const text = await response.text();
            return { status: response.status, data: text };
        }

        const data = await response.json();
        return { status: response.status, data };
    };
}
