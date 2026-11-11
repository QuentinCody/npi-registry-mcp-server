import type { ApiCatalog } from "@bio-mcp/shared/codemode/catalog";

export const npiCatalog: ApiCatalog = {
    name: "NPPES NPI Registry",
    baseUrl: "https://npiregistry.cms.hhs.gov/api",
    version: "2.1",
    auth: "none",
    endpointCount: 7,
    notes:
        "- Registry requests go to the root endpoint with version=2.1 query param\n" +
        "- Maximum 200 results per request (use `limit` param), use `skip` for pagination (up to 1200 total)\n" +
        "- NPI-1 = individual providers (physicians, nurses, therapists, etc.)\n" +
        "- NPI-2 = organizations (hospitals, clinics, pharmacies, labs, etc.)\n" +
        "- Response shape: { result_count: number, results: [{ number, basic, addresses, taxonomies, identifiers, other_names, ... }] }\n" +
        "- `basic` contains: name (first_name/last_name for NPI-1, organization_name for NPI-2), credential, gender, enumeration_date, status\n" +
        "- `addresses` array: address_1, city, state, postal_code, telephone_number, address_purpose (LOCATION/MAILING)\n" +
        "- `taxonomies` array: code, desc, primary (boolean), state, license\n" +
        "- taxonomy_description supports wildcards: 'cardio*' matches Cardiology, Cardiovascular Disease, etc.\n" +
        "- State uses 2-letter abbreviation (e.g., 'CA', 'NY', 'TX')\n" +
        "- NPI is a 10-digit number with Luhn check digit\n" +
        "- use_first_name_alias=false requests exact first names for individuals/authorized officials without a wildcard. The native default includes aliases; this is not an exact organization-name filter. exact_match is unsupported.\n" +
        "- Empty result: { result_count: 0, results: [] }\n" +
        "- The API has no authentication and is free to use\n" +
        "- Bulk V2 is a file format, not Registry API 2.1. /bulk/releases discovers CMS download links; /bulk/join joins checksum-labelled offline subsets without fetching ZIPs. Weekly increments and deactivations remain separate from monthly snapshots. No snapshot reconstruction or credential validation is implied.",
    workflows: [
        {title: "Discover NPPES V2 monthly, weekly and deactivation releases", description: "Keep the current provider listing and its hash; download and SHA-256 pin the selected archive outside the Worker. Use scripts/extract_v2.py to scan exact members for selected NPIs and POST its packet to /bulk/join. Do not use weekly deltas as full snapshots.", keywords: ["bulk", "V2", "monthly", "weekly", "deactivation", "locations"], code: `return await api.get("/bulk/releases");`},
    ],
    endpoints: [
        {method: "GET", path: "/bulk/releases", summary: "Discover live CMS NPPES V2 archive links and their release kinds", category: "bulk", queryParams: [{name: "expected_listing_sha256", type: "string", required: false, description: "Optional listing drift check; not an archive checksum"}]},
        {method: "POST", path: "/bulk/join", summary: "Join exact NPIs across checksum-labelled V2 provider, location, other-name, endpoint and deactivation subsets", category: "bulk", body: {contentType: "application/json", description: "Output of scripts/extract_v2.py: {format_version:'nppes-v2-extract-1', bulk_version:'2', npis:[...], files:[{kind,source_url,release_kind,release_label,archive_sha256,member,member_sha256,complete_scan:true,rows:[native string-valued CSV rows]}]}. Max 1 MiB, 100 NPIs, 20 files, 1000 rows. Caller-supplied hashes are not independently verified by this Worker."}, usageHint: "Preserves one-to-many reference rows and extended field lengths. Sources and dates remain separate. Empty subsets do not prove active status; deactivation/reactivation is not automatically reconciled. Combine separately extracted packets by concatenating files only when the requested NPIs match."},
        {
            method: "GET",
            path: "/providers/search",
            summary:
                "Search healthcare providers by name, specialty, or location. Returns matching NPI records with full details.",
            category: "providers",
            queryParams: [
                {
                    name: "first_name",
                    type: "string",
                    required: false,
                    description: "Provider first name (NPI-1 individual). Supports partial match.",
                },
                {
                    name: "last_name",
                    type: "string",
                    required: false,
                    description: "Provider last name (NPI-1 individual). Supports partial match.",
                },
                {
                    name: "organization_name",
                    type: "string",
                    required: false,
                    description: "Organization name (NPI-2). Supports partial match.",
                },
                {
                    name: "taxonomy_description",
                    type: "string",
                    required: false,
                    description:
                        "Provider specialty/taxonomy (e.g., 'Internal Medicine', 'Cardiology', 'Pharmacy'). Supports wildcards like 'cardio*'.",
                },
                {
                    name: "city",
                    type: "string",
                    required: false,
                    description: "City name",
                },
                {
                    name: "state",
                    type: "string",
                    required: false,
                    description: "2-letter state abbreviation (e.g., 'CA', 'NY')",
                },
                {
                    name: "postal_code",
                    type: "string",
                    required: false,
                    description: "5-digit or 9-digit ZIP code",
                },
                {
                    name: "enumeration_type",
                    type: "string",
                    required: false,
                    description: "NPI-1 (individual) or NPI-2 (organization)",
                    enum: ["NPI-1", "NPI-2"],
                },
                {
                    name: "limit",
                    type: "number",
                    required: false,
                    description: "Max results per page (1-200, default 10)",
                },
                {
                    name: "skip",
                    type: "number",
                    required: false,
                    description: "Number of results to skip for pagination",
                },
                {
                    name: "use_first_name_alias",
                    type: "boolean",
                    required: false,
                    description: "Include similar first names/aliases (default true); false requests exact first names when no wildcard is used. Applies to individuals and authorized officials, not organization names.",
                },
                {
                    name: "country_code",
                    type: "string",
                    required: false,
                    description: "Country code (e.g., 'US')",
                },
            ],
        },
        {
            method: "GET",
            path: "/providers/lookup",
            summary:
                "Look up a specific provider by their 10-digit NPI number. Returns full provider record with credentials, addresses, and taxonomies.",
            category: "providers",
            queryParams: [
                {
                    name: "number",
                    type: "string",
                    required: true,
                    description: "10-digit NPI number (e.g., '1234567893')",
                },
            ],
        },
        {
            method: "GET",
            path: "/providers/organizations",
            summary:
                "Search for healthcare organizations (hospitals, clinics, pharmacies, labs) by name and location. Automatically filters to NPI-2 type.",
            category: "organizations",
            queryParams: [
                {
                    name: "organization_name",
                    type: "string",
                    required: false,
                    description: "Organization name (e.g., 'Mayo Clinic', 'CVS'). Supports partial match.",
                },
                {
                    name: "taxonomy_description",
                    type: "string",
                    required: false,
                    description:
                        "Organization type/specialty (e.g., 'General Acute Care Hospital', 'Pharmacy', 'Clinical Laboratory')",
                },
                {
                    name: "city",
                    type: "string",
                    required: false,
                    description: "City name",
                },
                {
                    name: "state",
                    type: "string",
                    required: false,
                    description: "2-letter state abbreviation",
                },
                {
                    name: "postal_code",
                    type: "string",
                    required: false,
                    description: "ZIP code",
                },
                {
                    name: "limit",
                    type: "number",
                    required: false,
                    description: "Max results (1-200, default 10)",
                },
                {
                    name: "skip",
                    type: "number",
                    required: false,
                    description: "Pagination offset",
                },
            ],
        },
        {
            method: "GET",
            path: "/providers/by-specialty",
            summary:
                "Search providers by medical specialty/taxonomy description. Useful for finding all cardiologists, pharmacies, etc. in an area.",
            category: "specialty",
            queryParams: [
                {
                    name: "taxonomy_description",
                    type: "string",
                    required: true,
                    description:
                        "Specialty description. Supports wildcards (e.g., 'Oncology', 'cardio*', 'Emergency Medicine'). Common values: Internal Medicine, Family Practice, Cardiology, Oncology, Neurology, Orthopedic Surgery, Psychiatry, Dermatology, Radiology, Emergency Medicine, Pharmacy, General Acute Care Hospital, Clinical Laboratory, Skilled Nursing Facility.",
                },
                {
                    name: "state",
                    type: "string",
                    required: false,
                    description: "2-letter state abbreviation to filter by location",
                },
                {
                    name: "city",
                    type: "string",
                    required: false,
                    description: "City name",
                },
                {
                    name: "enumeration_type",
                    type: "string",
                    required: false,
                    description: "NPI-1 (individual) or NPI-2 (organization)",
                    enum: ["NPI-1", "NPI-2"],
                },
                {
                    name: "limit",
                    type: "number",
                    required: false,
                    description: "Max results (1-200, default 10)",
                },
                {
                    name: "skip",
                    type: "number",
                    required: false,
                    description: "Pagination offset",
                },
            ],
        },
        {
            method: "GET",
            path: "/providers/by-location",
            summary:
                "Search providers by geographic location (state, city, or ZIP code). Combine with specialty to find specific provider types in an area.",
            category: "location",
            queryParams: [
                {
                    name: "state",
                    type: "string",
                    required: false,
                    description: "2-letter state abbreviation (e.g., 'CA', 'NY', 'TX')",
                },
                {
                    name: "city",
                    type: "string",
                    required: false,
                    description: "City name (e.g., 'San Francisco', 'New York')",
                },
                {
                    name: "postal_code",
                    type: "string",
                    required: false,
                    description: "5-digit or 9-digit ZIP code",
                },
                {
                    name: "taxonomy_description",
                    type: "string",
                    required: false,
                    description: "Optional specialty filter",
                },
                {
                    name: "enumeration_type",
                    type: "string",
                    required: false,
                    description: "NPI-1 (individual) or NPI-2 (organization)",
                    enum: ["NPI-1", "NPI-2"],
                },
                {
                    name: "limit",
                    type: "number",
                    required: false,
                    description: "Max results (1-200, default 10)",
                },
                {
                    name: "skip",
                    type: "number",
                    required: false,
                    description: "Pagination offset",
                },
            ],
        },
    ],
};
