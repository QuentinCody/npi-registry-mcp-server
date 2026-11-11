import {McpServer} from "@bio-mcp/shared/mcp";
import {createApiProxyTool} from "@bio-mcp/shared/tools/api-proxy";
import {afterEach, expect, it, vi} from "vitest";
import {createNpiApiFetch} from "../lib/api-adapter";
import {npiCatalog} from "../spec/catalog";
import {registerCodeMode} from "./code-mode";
import {registerGetSchema} from "./get-schema";
import {registerQueryData} from "./query-data";

const json = (data: unknown) => new Response(JSON.stringify(data), {headers: {"Content-Type": "application/json"}});
afterEach(() => vi.unstubAllGlobals());
it("registers all four tools with both aliases and both response fields", async () => {
  const server = new McpServer({name: "fixture", version: "1"});
  registerCodeMode(server, {CODE_MODE_LOADER: {get: () => ({})}} as unknown as Parameters<typeof registerCodeMode>[1]);
  registerGetSchema(server, {}); registerQueryData(server, {});
  const tools = (server as unknown as {_registeredTools: Record<string, {handler: (args: unknown, extra: unknown) => Promise<unknown>}>})._registeredTools;
  for (const suffix of ["search", "execute", "query_data", "get_schema"]) {
    expect(tools[`npi_${suffix}`]).toBeDefined(); expect(tools[`mcp_npi_${suffix}`]).toBeDefined();
  }
  expect(await tools.npi_search.handler({query: "bulk", max_results: 5}, {})).toMatchObject({content: expect.any(Array), structuredContent: {success: true}});
  expect(await tools.mcp_npi_query_data.handler({data_access_id: "fixture", sql: "SELECT 1"}, {})).toMatchObject({isError: true, content: expect.any(Array), structuredContent: expect.any(Object)});
});
it("stages wide V2 values and all location matches with source hashes", async () => {
  const rows = Array.from({length: 100}, (_, i) => ({NPI: "1234567893", Address: `Location ${i}`, "Provider Organization Name (Legal Business Name)": "α".repeat(400)}));
  const file = {kind: "practice_locations", source_url: "https://download.cms.gov/nppes/fixture_V2.zip", release_kind: "monthly_snapshot", release_label: "Synthetic V2", archive_sha256: "a".repeat(64), member: "locations.csv", member_sha256: "b".repeat(64), complete_scan: true, rows};
  const body = {format_version: "nppes-v2-extract-1", bulk_version: "2", npis: ["1234567893"], files: [file]};
  const stored: unknown[] = [];
  const namespace = {idFromName: (name: string) => name, get: () => ({fetch: async (request: Request) => {
    if (new URL(request.url).pathname === "/process") { stored.push((await request.json() as {data: unknown}).data); return json({success: true, tables_created: ["providers"], total_rows: 1, input_rows: 1, table_row_counts: {providers: 1}}); }
    return json({success: true, schema: {tables: {providers: {columns: [{name: "npi"}]}}}});
  }})} as unknown as DurableObjectNamespace;
  const proxy = createApiProxyTool({apiFetch: createNpiApiFetch(), catalog: npiCatalog, doNamespace: namespace, stagingPrefix: "npi", maxInlineBytes: 30 * 1024});
  const result = await proxy.handler({method: "POST", path: "/bulk/join", body}, {sql: () => []});
  expect(result).toMatchObject({__staged: true, data_access_id: expect.any(String)});
  expect(JSON.parse(stored[0] as string)).toMatchObject({providers: [{npi: "1234567893", sources: [file]}], _nppes: {snapshot_reconstructed: false, row_count: 100}});
  expect(new TextEncoder().encode(JSON.stringify(result)).length).toBeLessThan(100000);
});
it("marks rejected V1 packets as API errors", async () => {
  const proxy = createApiProxyTool({apiFetch: createNpiApiFetch(), catalog: npiCatalog, stagingPrefix: "npi"});
  expect(await proxy.handler({method: "POST", path: "/bulk/join", body: {bulk_version: "1"}}, {sql: () => []})).toMatchObject({__api_error: true, incomplete: true, status: 400});
});
