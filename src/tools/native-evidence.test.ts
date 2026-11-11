import { verifyCitationEnvelope } from "@bio-mcp/shared";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ RpcTarget: class {}, DurableObject: class { constructor(public ctx: unknown, public env: unknown) {} } }));

import { fixture, recover } from "./staging-fixture";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function invoke(f: ReturnType<typeof fixture>, name: string, args: Record<string, unknown>, failed = false) {
  const result = await f.tools[name].handler(args, {});
  expect(result.isError === true, JSON.stringify(result).slice(0, 500)).toBe(failed);
  expect(result.content.length).toBeGreaterThan(0);
  const sc = result.structuredContent;
  const id = sc.staged ? sc.data_access_id : sc.data?.__staged ? sc.data.data_access_id : undefined;
  const staged = id ? await recover(f, id, "") : undefined;
  const proof = await verifyCitationEnvelope({ citation: sc._meta?.citation, structuredContent: sc, toolArguments: args,
    ...(staged ? { materialized: { value: staged } } : {}) });
  expect(proof.verification).toMatchObject({ query: "verified", result: "verified" });
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(30720);
  return { sc, id, data: sc.staged ? staged.structuredContent.data : sc.data?.__staged ? staged : sc.data };
}

it.each(["", "mcp_"])("verifies all %s aliases, argument hashes and error envelopes", async prefix => {
  const f = fixture();
  try {
    await invoke(f, `${prefix}npi_search`, { query: "wastewater" });
    await invoke(f, `${prefix}npi_execute`, { code: "return {value:'001'};" });
    await invoke(f, `${prefix}npi_execute`, { code: "" }, true);
    await invoke(f, `${prefix}npi_query_data`, { data_access_id: "missing", sql: "SELECT * FROM missing" }, true);
    await invoke(f, `${prefix}npi_get_schema`, { data_access_id: "missing" });
  } finally { f.close(); }
});

it("retains all bulk rows, empty source matches and workbook context in real SQLite", async () => {
  const f = fixture();
  const rows = Array.from({length: 100}, (_, i) => ({NPI: "1730979303", code: "001", value: "9007199254740993", location: String(i), name: "α😀".repeat(100)}));
  const source = {kind: "practice_locations", source_url: "https://download.cms.gov/nppes/fixture_V2.zip", release_kind: "weekly_incremental", release_label: "Fixture", archive_sha256: "a".repeat(64), member: "locations.csv", member_sha256: "b".repeat(64), complete_scan: true, rows};
  const deactivation = {...source, kind: "deactivations", release_kind: "deactivation", member: "deactivated.xlsx", extraction: {format: "xlsx", worksheet: "DeactivatedNPIs", title: "NPPES Deactivated Records as of Sep 14 2026", rows_scanned: 355330}, rows: [{NPI: "1730979303", "NPPES Deactivation Date": "09/14/2026"}]};
  const packet = {format_version: "nppes-v2-extract-1", bulk_version: "2", npis: ["1730979303", "1234567893"], files: [source, deactivation]};
  try {
    const result = await invoke(f, "npi_execute", {code: `return await api.post('/bulk/join',${JSON.stringify(packet)});`});
    expect(result.id).toBeTruthy(); expect(result.data._nppes.row_count).toBe(101);
    expect(result.data.providers[0].sources).toEqual(packet.files);
    expect(result.data.providers[1].sources.every((v: {rows: unknown[]}) => v.rows.length === 0)).toBe(true);
    const queried = await invoke(f, "mcp_npi_query_data", {data_access_id: result.id, sql: "SELECT npi,kind,json_extract(native_json,'$.code') AS code,json_extract(native_json,'$.value') AS value FROM bulk_rows WHERE kind='practice_locations' ORDER BY row_index LIMIT 2"});
    expect(queried.data.rows).toEqual(Array.from({length: 2}, () => ({npi: "1730979303", kind: "practice_locations", code: "001", value: "9007199254740993"})));
    const context = await invoke(f, "npi_query_data", {data_access_id: result.id, sql: "SELECT npi,matched_rows,native_json FROM bulk_sources WHERE kind='deactivations' ORDER BY provider_index"});
    expect(context.data.rows.map((v: {matched_rows: number}) => v.matched_rows)).toEqual([1, 0]);
    expect(JSON.parse(context.data.rows[0].native_json).extraction).toEqual(deactivation.extraction);
  } finally {f.close();}
});

it("preserves nested Registry records and native postal-code strings through SQL", async () => {
  const f = fixture();
  const provider = {number: 1730979303, basic: {organization_name: "α".repeat(20000)}, addresses: [{postal_code: "00123", address_purpose: "MAILING"}, {postal_code: "001230001", address_purpose: "LOCATION"}], taxonomies: [{code: "001", primary: true}], future: {kept: [null, "001"]}};
  const native = {result_count: 1, results: [provider]};
  vi.stubGlobal("fetch", async () => Response.json(native));
  try {
    const result = await invoke(f, "npi_execute", {code: 'return await api.get("/providers/lookup",{number:"1730979303"});'});
    expect(result.data).toEqual(native);
    const addresses = await invoke(f, "mcp_npi_query_data", {data_access_id: result.id, sql: "SELECT npi,native_json,postal_code,typeof(postal_code) AS kind FROM addresses ORDER BY source_index"});
    expect(addresses.data.rows.map((r: {native_json: string}) => JSON.parse(r.native_json))).toEqual(provider.addresses);
    expect(addresses.data.rows[0]).toMatchObject({npi: "1730979303", postal_code: "00123", kind: "text"});
  } finally {f.close();}
});

it("retains complete provider Errors and HTTP failures, plus oversized composed outputs", async () => {
  const f = fixture();const problem = {Errors: [{description: "α".repeat(30000), field: "number", number: "06", future: [null, "001"]}]};
  try {
    for (const status of [200, 400]) {
      vi.stubGlobal("fetch", async () => Response.json(problem, {status}));
      const result = await invoke(f, "npi_execute", {code: 'return await api.get("/providers/lookup",{number:"1"});'}, true);
      expect(result.data.status).toBe(status);
      const evidence = result.data.data.__staged ? await recover(f, result.data.data.data_access_id, "") : result.data.data;
      expect(evidence.problem).toEqual(problem);expect(JSON.parse(evidence.response)).toEqual(problem);
    }
    const composed = await invoke(f, "mcp_npi_execute", {code: 'return {notes:"α😀".repeat(12000),values:[0,null,"001"]};'});
    expect(composed.sc.staged).toBe(true);expect(composed.data.notes).toBe("α😀".repeat(12000));
  } finally {f.close();}
});
