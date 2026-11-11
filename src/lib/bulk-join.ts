import {archiveUrl, FILE_KINDS, fail, sha256} from "./bulk";

type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("Expected an object");
  return value as ObjectValue;
}
export async function joinBulk(input: unknown) {
  const serialized = JSON.stringify(input);
  if (!serialized || new TextEncoder().encode(serialized).length > 1024 * 1024) fail("Bulk subset exceeds 1 MiB");
  const body = object(input);
  if (body.format_version !== "nppes-v2-extract-1" || body.bulk_version !== "2") fail("Expected an NPPES V2 extraction packet");
  if (!Array.isArray(body.npis) || !body.npis.length || body.npis.length > 100 || body.npis.some(npi => typeof npi !== "string" || !/^\d{10}$/.test(npi)) || new Set(body.npis).size !== body.npis.length) fail("Provide 1–100 distinct ten-digit string NPIs");
  const npis = body.npis as string[];
  if (!Array.isArray(body.files) || !body.files.length || body.files.length > 20) fail("Provide 1–20 extracted files");
  let { files, count } = validateBulkFiles(body.files, npis);
  return {
    providers: npis.map(npi => ({npi, sources: files.map(({rows, ...source}) => ({...source, rows: rows.filter(row => row.NPI === npi)}))})),
    _nppes: {input_sha256: await sha256(serialized), bulk_version: "2", provenance_basis: "caller-supplied extraction; archive/member hashes are not independently verified by this Worker", row_count: count, snapshot_reconstructed: false, interpretation: "Exact NPI join only. Weekly increments are not full snapshots. Empty member matches do not establish current provider status. Deactivation/reactivation dates remain native evidence; no automatic status reconciliation. NPI issuance does not validate licensing or credentials."},
  };
}

function validateBulkFiles(values: unknown[], npis: string[]) {
  let count = 0;
  const files = values.map(value => {
    const file = object(value);
    if (!FILE_KINDS.includes(file.kind as typeof FILE_KINDS[number])) fail("Unknown NPPES member kind");
    const source = archiveUrl(file.source_url);
    if (!["monthly_snapshot", "weekly_incremental", "deactivation"].includes(String(file.release_kind)) || typeof file.release_label !== "string" || !file.release_label.trim() || file.release_label.length > 512) fail("Explicit release kind and label required");
    for (const key of ["archive_sha256", "member_sha256"]) if (typeof file[key] !== "string" || !/^[a-f0-9]{64}$/i.test(file[key] as string)) fail("Archive/member SHA-256 required");
    if (typeof file.member !== "string" || !file.member || file.member.length > 512 || file.complete_scan !== true) fail("A complete member scan with exact member name is required");
    if (!Array.isArray(file.rows)) fail("Expected native CSV rows");
    count += file.rows.length;
    if (count > 1000) fail("Bulk subset exceeds 1000 rows");
    const rows = file.rows.map(value => {
      const row = object(value);
      if (typeof row.NPI !== "string" || !npis.includes(row.NPI) || Object.values(row).some(cell => typeof cell !== "string")) fail("Rows must preserve native string cells and an explicitly requested NPI");
      return row;
    });
    return { ...file, kind: file.kind, source_url: source, release_kind: file.release_kind, release_label: file.release_label, archive_sha256: file.archive_sha256, member_sha256: file.member_sha256, member: file.member, complete_scan: true, rows };
  });
  return { files, count };
}
