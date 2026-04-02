import { RestStagingDO } from "@bio-mcp/shared/staging/rest-staging-do";
import type { SchemaHints } from "@bio-mcp/shared/staging/schema-inference";

export class NpiRegistryDataDO extends RestStagingDO {
    protected getSchemaHints(data: unknown): SchemaHints | undefined {
        if (!data || typeof data !== "object") return undefined;

        // NPPES API wraps results in { result_count, results: [...] }
        const obj = data as Record<string, unknown>;
        if (Array.isArray(obj.results)) {
            return {
                tableName: "providers",
                indexes: ["number", "enumeration_type"],
            };
        }

        if (Array.isArray(data)) {
            const sample = data[0];
            if (sample && typeof sample === "object") {
                // Array of provider records
                if ("number" in sample || "basic" in sample) {
                    return {
                        tableName: "providers",
                        indexes: ["number", "enumeration_type"],
                    };
                }
                // Taxonomy entries
                if ("code" in sample && "desc" in sample && "license" in sample) {
                    return {
                        tableName: "taxonomies",
                        indexes: ["code", "state"],
                    };
                }
                // Address entries
                if ("address_1" in sample && "city" in sample && "state" in sample) {
                    return {
                        tableName: "addresses",
                        indexes: ["city", "state", "postal_code"],
                    };
                }
            }
        }

        return undefined;
    }
}
