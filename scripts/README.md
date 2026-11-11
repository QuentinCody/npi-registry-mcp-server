# NPPES V2 exact-NPI extraction

Run `api.get("/bulk/releases")` through `npi_execute` to discover the current CMS
archives. Download the chosen V2 ZIP outside the Worker and retain it. Compute its
SHA-256 (`shasum -a 256 FILE.zip`) and record the exact download URL and release
label. This is a locally computed fingerprint, not a CMS signature. Inspect the
ZIP directory and bundled current README before selecting exact CSV/workbook members.

```sh
python3 servers/npi-registry-mcp-server/scripts/extract_v2.py \
  --archive /path/to/retained_V2.zip \
  --expected-sha256 THE_64_HEX_ARCHIVE_DIGEST \
  --source-url https://download.cms.gov/nppes/EXACT_ADVERTISED_FILENAME.zip \
  --release-kind monthly_snapshot \
  --release-label 'EXACT CMS RELEASE LABEL' \
  --member providers=EXACT_PROVIDER_MEMBER.csv \
  --member practice_locations=EXACT_LOCATION_MEMBER.csv \
  --npi 1234567893 \
  --out /path/to/new-subset.json
```

Replace the illustrative paths, member names, digest and NPI. `--member` may repeat;
valid kinds are `providers`, `other_names`, `practice_locations`, `endpoints`, and
`deactivations`. For the observed monthly workbook use
`--member 'deactivations=NPPES Deactivated NPI Report 20260914.xlsx'` with the
corresponding advertised ZIP, hash and release label. XLSX is supported only for
the `DeactivatedNPIs` deactivation sheet, with its native title in row 1 and headers
in row 2. NPIs may repeat as flags but their values must be distinct. Choose
`weekly_incremental` or `deactivation` for those archives. These labels describe the
operator-selected source; the extractor does not prove that a URL or member is V2.
It verifies the retained archive's bytes against the supplied SHA-256, scans each
selected member to EOF, checks ZIP CRCs while reading, hashes uncompressed members,
and preserves every matching native string cell. `extraction` records headers,
rows scanned and, for XLSX, sheet/title context. The bundled current README is
the source for member/schema interpretation; the public 2012 README is not a V2
field-length specification.

The JSON output is a request body for `api.post("/bulk/join", packet)` in Code Mode.
It can be loaded through the client's supported file/JSON input mechanism; the
remote Worker cannot read a local filesystem path. To combine releases, concatenate
`files` from packets with the exact same `npis`. The Worker labels the hashes as
caller-supplied, preserves separate source rows, and performs no archive download.

Limits: 100 NPIs, 20 members, 1000 matching rows and 1 MiB output. Narrow the selection
when exceeded; partial files are never emitted. CSV and worksheet rows are streamed,
including unmatched rows. The inner XLSX container is bounded at 64 MiB, its total
uncompressed content at 256 MiB, worksheet XML at 128 MiB and metadata/shared-string
parts at 16 MiB. No member is unpacked to a filesystem path. Output publication
refuses overwrite. XLSX text cells preserve native dates and NPI strings; absent
cells become empty strings. Formulas, numeric/date cells, duplicate ZIP entries,
unsupported layouts and XML entity declarations fail without publishing a subset.
Long names, leading-zero strings, quoted commas/newlines, duplicate reference rows
and unknown columns survive. Missing/duplicate headers, invalid UTF-8, corrupt ZIPs,
row-width mismatch and checksum mismatch fail the extraction.

This is exact-NPI extraction and joining, not a reconstructed nationwide provider
snapshot. Monthly snapshots, weekly deltas, deactivation and reactivation evidence
retain their source context. The tool does not infer active status from absent rows,
apply deletion semantics, or validate professional licensing. Registry API 2.1
lookups are separately observed current data, not a replacement for a pinned bulk
release. October 4 validation fully scanned 34,009 provider rows, 12,856 secondary
locations, 2,489 endpoints, 2,601 other names and 355,330 deactivation rows. All four
CSV headers matched their bundled header files; the workbook contains 710,663 text
cells and no formulas. The 139 selected rows match independent native reads and the
actual CLI output. The monthly provider ZIP remains unverified. See the
[acceptance receipt](../../../scratch/2026-10-04-npi/verification.json).

```sh
python3 -m unittest discover -s servers/npi-registry-mcp-server/scripts -p 'test_*.py'
```
