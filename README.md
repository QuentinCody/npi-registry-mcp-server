# NPI Registry MCP Server

This is a [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server. It lets MCP clients (Claude Desktop, Claude Code, Continue, etc.) query the upstream NPI Registry API in natural language. It is one of 100+ servers in the [Bio MCP](../../README.md) monorepo.

## Connect

The configured production endpoint is:

```
https://npi-registry-mcp-server.quentincody.workers.dev/mcp
```

Add it to your MCP client (Claude Desktop → Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "npi-registry": {
      "command": "npx",
      "args": ["mcp-remote", "https://npi-registry-mcp-server.quentincody.workers.dev/mcp"]
    }
  }
}
```

For local development the server runs at `http://localhost:8870/mcp` (start it with `./scripts/dev-servers.sh npi-registry`):

```json
{
  "mcpServers": {
    "npi-registry-local": {
      "command": "npx",
      "args": ["mcp-remote", "http://localhost:8870/mcp"]
    }
  }
}
```

## Tools

- `npi_search` — discover available API operations (Code Mode catalog search)
- `npi_execute` — **Code Mode**: write JavaScript in a V8 isolate (`api.get()` / `api.post()` / `searchSpec()`) instead of issuing tool calls one by one
- `npi_query_data` — run SQL over large responses auto-staged into a per-session SQLite database
- `npi_get_schema` — inspect the inferred schema of a staged dataset

Large responses (>30KB) are auto-staged into a queryable SQLite database; the tools return a `data_access_id` you can query with SQL.

Every tool returns both a human-readable `content` summary and a structured `structuredContent` payload.

## Development

```bash
./scripts/dev-servers.sh npi-registry            # run locally (port 8870)
pnpm --filter npi-registry-mcp-server run deploy   # deploy to Cloudflare Workers
```

See [`docs/adding-mcp-servers.md`](../../docs/adding-mcp-servers.md) and the root [README](../../README.md) for the full architecture (Code Mode, staging, portals).

---

*Auto-generated baseline README — refine with server-specific detail as needed.*

## NPPES bulk V2 and reference-file joins

The [CMS download notice](https://download.cms.gov/nppes/NPI_Files.html) ends V1
monthly/weekly publication on March 3, 2026 and identifies expanded V2 first-name
and legal-business-name lengths. This does not change Registry API version 2.1.

`api.get("/bulk/releases")` discovers currently advertised V2 monthly snapshots,
weekly incremental updates and deactivation files with a listing SHA-256 and
retrieval time. It does not download ZIPs or claim historical completeness.
`api.post("/bulk/join", packet)` groups extracted native CSV/workbook rows by exact NPI,
retaining all alternate names, non-primary practice locations, endpoints and
provider/deactivation rows with their separate release labels and file hashes.

The [streaming extractor](scripts/README.md) produces this packet from retained,
checksum-pinned local ZIPs. Extended fields are not truncated. One-to-many rows
remain arrays; the join neither merges weekly files into a national snapshot nor
infers provider status or licensing from an NPI. The Worker labels extraction
provenance as caller-supplied rather than independently verified.

The observed monthly deactivation archive contains an XLSX workbook. The extractor
now supports its `DeactivatedNPIs` worksheet, retaining its title, headers, complete
scan count and text dates. Other file kinds use CSV. Formula cells, unexpected
layouts and numeric/date coercion are rejected rather than silently interpreted.

Registry reads pin API 2.1, bound `limit`/`skip`, preserve native results and surface
provider `Errors` envelopes. Organization searches enforce NPI-2. All four tools
also register `mcp_npi_*` aliases, and responses above 30 KiB stage for SQL access.

Registry validation errors can arrive with HTTP 200; MCP sets `isError` while
retaining the native status, complete response text and error fields. All aliases
carry verifiable citations, including errors and fully staged composed results.
Reads have a 15-second body deadline and a 4 MiB body limit (1 MiB for the release
listing). The supported first-name control is `use_first_name_alias: false`;
`exact_match` is rejected because it is not a documented Registry parameter.

Staged bulk joins expose `bulk_rows` with exact `native_json` and NPI/source/row
indices, plus `bulk_sources` for every requested NPI/file pair, including empty
matches. `response_context` retains join provenance. Registry `providers` and
separate nested tables retain addresses, taxonomies, identifiers, names, endpoints
and secondary locations. Inspect with `npi_get_schema`; query large JSON fields
using bounded `substr` chunks. `payloads` retains the complete original response.

October 4 native/local acceptance passed **666 MCP calls**. Complete scans of the
September 21–27 weekly ZIP and September 14 deactivation ZIP selected 139 rows
across ten NPIs; all 4,348 native cells and 50 source contexts matched through both
aliases and SQL. Registry pages, a 200-provider staged response, exact lookups,
empty results and full errors also matched native reads. The bundled May 12 V2
README specifies 35-character first names and 100-character legal business names;
the observed weekly data includes 27- and 84-character values. No fixed-width
truncation is performed.

**46 TypeScript tests, 16 Python tests, 203 catalog checks and 14 static checks**
pass. See the [receipt](../../scratch/2026-10-04-npi/verification.json).
The monthly provider ZIP, historical reconstruction and a native alias-expansion
difference remain unverified. These changes have not been deployed.

<!-- license-and-data-terms:start -->
## License and data terms

The code in this repository is licensed under the Apache License 2.0 (see `LICENSE`).
If you use it in your work, please cite it (see `CITATION.cff`). Citation is requested, not required.

The license covers the code only. Data that this server returns comes from NPPES NPI Registry and stays under the terms of that source: US public domain.
You are responsible for your use of the data under those terms.
<!-- license-and-data-terms:end -->
