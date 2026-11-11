import { createExecuteTool } from "@bio-mcp/shared/codemode/execute-tool";
import { createSearchTool } from "@bio-mcp/shared/codemode/search-tool";
import type { McpServer } from "@bio-mcp/shared/mcp";
import { createNpiApiFetch } from "../lib/api-adapter";
import { npiResponse } from "../lib/tool-result";
import { npiCatalog } from "../spec/catalog";

interface CodeModeEnv {
	NPI_REGISTRY_DATA_DO: DurableObjectNamespace;
	CODE_MODE_LOADER: WorkerLoader;
}

export function registerCodeMode(
	server: McpServer,
	env: CodeModeEnv,
): void {
	const apiFetch = createNpiApiFetch();

    const registrar = {tool: (...args: unknown[]) => {
        const [name, ...rest] = args;
        const handler = rest.pop() as (args: unknown, extra: unknown) => ReturnType<Parameters<typeof npiResponse>[0]>;
        const respond = (args: unknown, extra: unknown) => npiResponse(() => handler(args, extra), env, String(name), extra, args);
        const register = server.tool.bind(server) as (...values: unknown[]) => void;
        register(name, ...rest, respond); register(`mcp_${String(name)}`, ...rest, respond);
    }};
    const searchTool = createSearchTool({
		prefix: "npi",
		catalog: npiCatalog,
	});
	searchTool.register(registrar);

	const executeTool = createExecuteTool({
		prefix: "npi",
		// Verifiable provenance: npi_execute results carry a _meta.citation.
		source: { id: "npi", name: "NPPES NPI Registry", url: "https://npiregistry.cms.hhs.gov", license: "U.S. Public Domain" },
		catalog: npiCatalog,
		apiFetch,
        preserveApiErrors: true,
        stagingThreshold: 30 * 1024,
        maxInlineBytes: 30 * 1024,
        timeout: 90_000,
		doNamespace: env.NPI_REGISTRY_DATA_DO,
		loader: env.CODE_MODE_LOADER,
	});
	executeTool.register(registrar);
}
