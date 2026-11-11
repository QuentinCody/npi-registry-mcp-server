import { RestStagingDO } from "@bio-mcp/shared/staging/rest-staging-do";
import { flattenObject, type SchemaHints } from "@bio-mcp/shared/staging/schema-inference";

type Row = Record<string, unknown>;
const record = (value: unknown): value is Row => value !== null && typeof value === "object" && !Array.isArray(value);
const row = (value: unknown, path: string, index: number): Row => ({
  ...(record(value) ? { ...flattenObject(value, 2), ...Object.fromEntries(Object.entries(value).map(([key, item]) =>
    [key, item !== null && typeof item === "object" ? JSON.stringify(item) : item])) } : { value }),
  native_json: JSON.stringify(value), source_path: path, source_index: index,
});

function bulkTables(data: Row) {
  const providers: Row[] = [];
  const sources: Row[] = [];
  const rows: Row[] = [];
  for (const [providerIndex, provider] of (data.providers as unknown[]).entries()) {
    if (!record(provider) || !Array.isArray(provider.sources)) continue;
    providers.push({npi: provider.npi, provider_index: providerIndex, source_count: provider.sources.length});
    for (const [sourceIndex, source] of provider.sources.entries()) {
      if (!record(source) || !Array.isArray(source.rows)) continue;
      const {rows: values, ...context} = source;
      const link = {npi: provider.npi, provider_index: providerIndex, source_index: sourceIndex, kind: source.kind, member: source.member};
      sources.push({...link, matched_rows: values.length, native_json: JSON.stringify(context)});
      values.forEach((value, rowIndex) => { rows.push({...link, row_index: rowIndex, native_json: JSON.stringify(value)}); });
    }
  }
  const {providers: _providers, ...context} = data;
  return {providers, bulk_sources: sources, bulk_rows: rows, response_context: [{native_json: JSON.stringify(context)}]};
}

/** Retain source-specific bulk rows and nested Registry records without cross-products. */
export class NpiRegistryDataDO extends RestStagingDO {
  protected getTabularData(value: unknown): unknown {
    const data = record(value) && Array.isArray(value.content) && record(value.structuredContent) && "data" in value.structuredContent
      ? value.structuredContent.data : value;
    if (Array.isArray(data)) return {native_records: data.map((v, i) => row(v, `/${i}`, i))};
    if (!record(data)) return data;
    if (typeof data.sql === "string" && Array.isArray(data.rows)) return {query_rows: data.rows.map((v, i) => row(v, `/rows/${i}`, i))};
    if (Array.isArray(data.providers) && record(data._nppes)) return bulkTables(data);
    if (Array.isArray(data.files)) {
      const {files, ...context} = data;
      return {bulk_releases: files.map((v, i) => row(v, `/files/${i}`, i)), response_context: [{native_json: JSON.stringify(context)}]};
    }
    if (Array.isArray(data.results)) {
      const {results, ...context} = data;
      const tables: Record<string, Row[]> = {providers: results.map((v, i) => row(v, `/results/${i}`, i)), response_context: [{native_json: JSON.stringify(context)}]};
      for (const [index, provider] of results.entries()) if (record(provider)) {
        for (const key of ["addresses", "taxonomies", "identifiers", "other_names", "endpoints", "practice_locations"]) {
          const values = provider[key];
          if (!Array.isArray(values)) continue;
          tables[key] ??= [];
          tables[key].push(...values.map((v, i) => ({...row(v, `/results/${index}/${key}/${i}`, i), npi: String(provider.number), provider_index: index})));
        }
      }
      return tables;
    }
    return {native_objects: [row(data, "", 0)], response_context: [{native_json: JSON.stringify(data)}]};
  }

  protected getSchemaHints(value: unknown): SchemaHints {
    const tables = this.getTabularData(value);
    const columnTypes: Record<string, string> = {native_json: "TEXT", source_path: "TEXT", npi: "TEXT"};
    if (record(tables)) for (const values of Object.values(tables)) {
      if (!Array.isArray(values)) continue;
      for (const item of values) if (record(item)) for (const [key, value] of Object.entries(item)) {
        if (typeof value === "string") columnTypes[key] = "TEXT";
      }
    }
    return {columnTypes};
  }
}
