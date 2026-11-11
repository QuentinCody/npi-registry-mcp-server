import {afterEach, expect, it, vi} from "vitest";
import {createNpiApiFetch} from "./api-adapter";
import {discoverBulk, parseReleases, sha256} from "./bulk";
import {joinBulk} from "./bulk-join";

const html = `<a href="monthly_V2.zip">NPPES Data Dissemination V.2 (Synthetic September 2026)</a><a href='weekly_V2.zip'>NPPES Data Dissemination V.2 - Weekly Update - 092126_092726</a><a href="deactivated_V2.zip">NPPES Data Dissemination V.2 - Monthly Deactivation Update - September 2026</a>`;
const file = {kind: "providers", source_url: "https://download.cms.gov/nppes/monthly_V2.zip", release_kind: "monthly_snapshot", release_label: "Synthetic V2", archive_sha256: "a".repeat(64), member: "data.csv", member_sha256: "b".repeat(64), complete_scan: true, rows: [{NPI: "1234567893", "Provider First Name": "α".repeat(400), ZIP: "00123", "NPI Deactivation Date": "", "NPI Reactivation Date": "01/01/2025"}]};
export const subset = {format_version: "nppes-v2-extract-1", bulk_version: "2", npis: ["1234567893", "9999999999"], files: [file]};
afterEach(() => vi.unstubAllGlobals());
it("discovers monthly, incremental and deactivation archives separately", () => {
  expect(parseReleases(html).map(f => f.release_kind)).toEqual(["monthly_snapshot", "weekly_incremental", "deactivation"]);
  expect(parseReleases(html)[0]).toMatchObject({bulk_version: "2", artifact_bytes_verified: false});
});
it.each([
  '<a href="https://evil.test/v2.zip">NPPES Data Dissemination V.2</a>',
  '<a href="old.zip">NPPES Data Dissemination V.1</a>',
  '<a href="../other.zip">NPPES Data Dissemination V.2</a>',
  '<a href="monthly_V2.zip?token=x">NPPES Data Dissemination V.2</a>',
  '<a href="monthly_V2.zip">Unknown V.2</a>',
])("rejects unverified or unsafe archive discovery", sample => expect(() => parseReleases(sample)).toThrow());
it("keeps listing digest distinct from unverified archive bytes", async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response(html)); vi.stubGlobal("fetch", fetcher);
  expect(await discoverBulk({expected_listing_sha256: await sha256(html)})).toMatchObject({_nppes: {listing_sha256: await sha256(html), bulk_version: "2", registry_api_version: "2.1", snapshot_reconstructed: false}});
  expect(fetcher.mock.calls[0][0]).toBe("https://download.cms.gov/nppes/NPI_Files.html");
  expect(fetcher.mock.calls[0][1]).toMatchObject({redirect: "manual"});
});
it("detects listing drift", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(html)));
  await expect(discoverBulk({expected_listing_sha256: "0".repeat(64)})).rejects.toMatchObject({status: 409});
});
it("joins one-to-many rows without truncation or Cartesian duplication", async () => {
  const locations = {...file, kind: "practice_locations", member: "locations.csv", rows: [{NPI: "1234567893", Address: "One"}, {NPI: "1234567893", Address: "Two"}]};
  const result = await joinBulk({...subset, files: [file, locations]});
  expect(result.providers[0].sources[0].rows).toEqual(file.rows);
  expect(result.providers[0].sources[1].rows).toHaveLength(2);
  expect(result.providers[1].sources.every(source => source.rows.length === 0)).toBe(true);
  expect(result._nppes).toMatchObject({row_count: 3, snapshot_reconstructed: false});
});
it("retains distinct monthly, weekly and deactivation evidence", async () => {
  const files = [file, {...file, release_kind: "weekly_incremental", release_label: "Week", rows: [{NPI: "1234567893", "NPI Reactivation Date": "02/01/2025"}]}, {...file, kind: "deactivations", release_kind: "deactivation", rows: [{NPI: "1234567893", "NPI Deactivation Date": "01/01/2025"}]}];
  const result = await joinBulk({...subset, files});
  expect(result.providers[0].sources.map(source => source.release_kind)).toEqual(["monthly_snapshot", "weekly_incremental", "deactivation"]);
  expect(result.providers[0]).not.toHaveProperty("active");
});
it.each([
  {...subset, bulk_version: "1"}, {...subset, npis: [1234567893]}, {...subset, npis: ["1234567893", "1234567893"]},
  {...subset, files: [{...file, complete_scan: false}]}, {...subset, files: [{...file, archive_sha256: "unknown"}]},
  {...subset, files: [{...file, rows: [{NPI: "1234567893", code: 123}]}]}, {...subset, files: [{...file, rows: [{NPI: "0000000000"}]}]},
  {...subset, files: [{...file, release_kind: "latest"}]}, {...subset, files: [{...file, source_url: "https://evil.test/file.zip"}]},
  {...subset, files: [{...file, rows: Array.from({length: 1001}, () => ({NPI: "1234567893"}))}]},
  {...subset, files: [{...file, rows: [{NPI: "1234567893", name: "x".repeat(1024 * 1024)}]}]},
])("rejects ambiguous, malformed or excessive subsets", async input => { await expect(joinBulk(input)).rejects.toMatchObject({status: 400}); });
it("routes the offline join without network access", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  expect(await createNpiApiFetch()({method: "POST", path: "/bulk/join", body: subset})).toMatchObject({status: 200, data: {_nppes: {row_count: 1}}});
  expect(fetcher).not.toHaveBeenCalled();
});
it.each([
  {method: "POST", path: "/providers/search"}, {method: "GET", path: "/unknown"},
  {method: "GET", path: "/providers/search", params: {skip: 1001}}, {method: "GET", path: "/providers/search", params: {limit: 201}},
  {method: "GET", path: "/providers/search", params: {version: "2"}}, {method: "GET", path: "/bulk/join"},
    {method: "POST", path: "/bulk/releases"},
    {method: "GET", path: "/providers/search", params: {exact_match: true}},
    {method: "GET", path: "/providers/search", params: {use_first_name_alias: "false"}},
])("rejects wrong routes/versions and out-of-range Registry pagination", async request => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  await expect(createNpiApiFetch()(request)).rejects.toMatchObject({status: 400}); expect(fetcher).not.toHaveBeenCalled();
});
it("pins API 2.1 and NPI-2 for organization reads and preserves native JSON", async () => {
  const packet = {result_count: 1, results: [{number: 1234567893, basic: {organization_name: "x".repeat(600)}}]};
  const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(packet))); vi.stubGlobal("fetch", fetcher);
  expect(await createNpiApiFetch()({method: "GET", path: "/providers/organizations", params: {organization_name: "Fixture", enumeration_type: "NPI-1"}})).toEqual({status: 200, data: packet});
  const url = new URL(fetcher.mock.calls[0][0]);
  expect(url.searchParams.get("version")).toBe("2.1"); expect(url.searchParams.get("enumeration_type")).toBe("NPI-2");
});

it("sends the documented first-name alias parameter with the native False spelling", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({result_count: 0, results: []}));vi.stubGlobal("fetch", fetcher);
  await createNpiApiFetch()({method: "GET", path: "/providers/search", params: {first_name: "Robert", use_first_name_alias: false}});
  expect(new URL(fetcher.mock.calls[0][0]).searchParams.get("use_first_name_alias")).toBe("False");
});
it("does not turn a provider Errors envelope into successful empty results", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({Errors: [{description: "Fixture"}]}))));
  await expect(createNpiApiFetch()({method: "GET", path: "/providers/search"})).rejects.toMatchObject({status: 200, data: {problem: {Errors: [{description: "Fixture"}]}, http_status: 200}});
});
