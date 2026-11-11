import { fail, npiHttpError, readNpiResponse } from "./read-response";

export { fail } from "./read-response";

export const BULK_PAGE = "https://download.cms.gov/nppes/NPI_Files.html";
export const FILE_KINDS = ["providers", "other_names", "practice_locations", "endpoints", "deactivations"] as const;
export async function sha256(text: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}
export function archiveUrl(value: unknown): string {
  if (typeof value !== "string") fail("Expected a CMS archive URL");
  let url: URL;
  try { url = new URL(value); } catch { fail("Invalid CMS archive URL"); }
  if (url.origin !== "https://download.cms.gov" || url.username || url.password || url.search || url.hash || !/^\/nppes\/[A-Za-z0-9_.-]+\.zip$/i.test(url.pathname)) fail("Expected a fixed-host CMS NPPES ZIP URL");
  return url.href;
}
export async function readText(response: Response, maxBytes: number): Promise<string> {
  const raw = await readNpiResponse(response, maxBytes);
  if (!response.ok) npiHttpError(response, raw);
  return raw;
}
const decode = (value: string) => value.replace(/&amp;/gi, "&").replace(/&nbsp;/gi, " ").replace(/&#(?:x([a-f0-9]+)|(\d+));/gi, (match, hex, decimal) => {
  const n = Number.parseInt(hex ?? decimal, hex ? 16 : 10); return n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : match;
});
export function parseReleases(html: string) {
  const files = new Map<string, {source_url: string; release_label: string; release_kind: string; bulk_version: string; artifact_bytes_verified: boolean}>();
  for (const match of html.matchAll(/<a\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = decode(match[3].replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
    if (!/\bV\.?\s*2\b|Version\s*2\b/i.test(label)) continue;
    let source: string;
    try { source = archiveUrl(new URL(decode(match[1] ?? match[2]), BULK_PAGE).href); } catch { continue; }
    const kind = /deactivation/i.test(label) ? "deactivation" : /weekly/i.test(label) ? "weekly_incremental" : /NPPES Data Dissemination/i.test(label) ? "monthly_snapshot" : null;
    if (!kind) continue;
    if (files.has(source) && files.get(source)?.release_kind !== kind) fail("Ambiguous NPPES archive classification", 502);
    files.set(source, {source_url: source, release_label: label, release_kind: kind, bulk_version: "2", artifact_bytes_verified: false});
  }
  if (!files.size) fail("No V2 NPPES ZIP links found; release listing may have changed", 502);
  return [...files.values()];
}
export async function discoverBulk(params: Record<string, unknown>) {
  for (const key of Object.keys(params)) if (!["expected_listing_sha256"].includes(key)) fail("Unsupported bulk discovery parameter");
  const expected = params.expected_listing_sha256;
  if (expected !== undefined && (typeof expected !== "string" || !/^[a-f0-9]{64}$/i.test(expected))) fail("Expected a SHA-256 listing digest");
  let response: Response;
  try { response = await fetch(BULK_PAGE, {headers: {Accept: "text/html"}, redirect: "manual", signal: AbortSignal.timeout(30_000)}); }
  catch { fail("NPPES release discovery failed or timed out", 502); }
  const html = await readText(response, 1024 * 1024); const hash = await sha256(html);
  if (expected !== undefined && String(expected).toLowerCase() !== hash) fail("NPPES listing changed", 409);
  return {files: parseReleases(html), _nppes: {source_url: BULK_PAGE, retrieved_at: new Date().toISOString(), listing_sha256: hash, registry_api_version: "2.1", bulk_version: "2", archive_checksums: "Compute and pin SHA-256 after downloading; a listing digest is not an archive checksum.", snapshot_reconstructed: false}};
}
