import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createSearchTool } from "@bio-mcp/shared/codemode/search-tool";
import { createExecuteTool } from "@bio-mcp/shared/codemode/execute-tool";
import { npiCatalog } from "../spec/catalog";
import { createNpiApiFetch } from "../lib/api-adapter";

interface CodeModeEnv {
    NPI_REGISTRY_DATA_DO: DurableObjectNamespace;
    CODE_MODE_LOADER: WorkerLoader;
}

export function registerCodeMode(
    server: McpServer,
    env: CodeModeEnv,
): void {
    const apiFetch = createNpiApiFetch();

    const searchTool = createSearchTool({
        prefix: "npi",
        catalog: npiCatalog,
    });
    searchTool.register(server as unknown as { tool: (...args: unknown[]) => void });

    const executeTool = createExecuteTool({
        prefix: "npi",
        // Verifiable provenance: npi_execute results carry a _meta.citation.
        source: { id: "npi", name: "NPPES NPI Registry", url: "https://npiregistry.cms.hhs.gov", license: "U.S. Public Domain" },
        catalog: npiCatalog,
        apiFetch,
        doNamespace: env.NPI_REGISTRY_DATA_DO,
        loader: env.CODE_MODE_LOADER,
    });
    executeTool.register(server as unknown as { tool: (...args: unknown[]) => void });
}
