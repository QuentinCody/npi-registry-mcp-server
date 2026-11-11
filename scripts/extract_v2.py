"""Stream exact-NPI subsets from a checksum-pinned, locally retained NPPES V2 ZIP.

No downloads, ZIP extraction, snapshot mutation, or field-width truncation occurs.
Explicit member kinds avoid guessing schemas from changing archive filenames.
"""
import argparse
import csv
import hashlib
import io
import json
import os
from pathlib import Path
import re
import tempfile
from urllib.parse import urlsplit
import zipfile
from xlsx_deactivation import deactivation_rows

KINDS = {"providers", "other_names", "practice_locations", "endpoints", "deactivations"}
MAX_BYTES = 1024 * 1024


class HashReader(io.RawIOBase):
    def __init__(self, stream):
        self.stream = stream
        self.digest = hashlib.sha256()

    def readable(self):
        return True

    def readinto(self, buffer):
        block = self.stream.read(len(buffer))
        self.digest.update(block)
        buffer[:len(block)] = block
        return len(block)


def native_rows(hashing, member, kind, context):
    if member.lower().endswith(".xlsx"):
        if kind != "deactivations":
            raise ValueError("XLSX is supported only for the observed deactivation format")
        raw = hashing.read(64 * 1024 * 1024 + 1)
        if len(raw) > 64 * 1024 * 1024:
            raise ValueError("Deactivation workbook exceeds 64 MiB")
        yield from deactivation_rows(raw, context)
        return
    context["format"] = "csv"
    with io.TextIOWrapper(io.BufferedReader(hashing), encoding="utf-8-sig", newline="") as text:
        reader = csv.reader(text, strict=True)
        headers = next(reader, None)
        if not headers or "NPI" not in headers or len(set(headers)) != len(headers) or any(not key for key in headers):
            raise ValueError("CSV needs unique nonempty headers and NPI column")
        context["headers"] = headers
        for cells in reader:
            if len(cells) != len(headers):
                raise ValueError("CSV row width differs from header; incomplete extraction rejected")
            yield dict(zip(headers, cells))


def validate_extract_request(source_url, release_kind, release_label, expected_sha256, npis, members):
    url = urlsplit(source_url)
    if url.scheme != "https" or url.netloc != "download.cms.gov" or url.query or url.fragment or not re.fullmatch(r"/nppes/[A-Za-z0-9_.-]+\.zip", url.path, re.I):
        raise ValueError("Expected a CMS NPPES archive URL")
    if release_kind not in {"monthly_snapshot", "weekly_incremental", "deactivation"} or not release_label.strip():
        raise ValueError("Explicit release kind/label required")
    if not re.fullmatch(r"[a-fA-F0-9]{64}", expected_sha256):
        raise ValueError("Expected archive SHA-256 required")
    if not 1 <= len(npis) <= 100 or len(set(npis)) != len(npis) or any(not re.fullmatch(r"\d{10}", npi) for npi in npis):
        raise ValueError("Provide 1–100 distinct ten-digit string NPIs")
    if not 1 <= len(members) <= 20 or len({name for _, name in members}) != len(members) or any(kind not in KINDS for kind, _ in members):
        raise ValueError("Provide 1–20 distinct members with explicit kinds")


def extract(archive, expected_sha256, source_url, release_kind, release_label, members, npis):
    validate_extract_request(source_url, release_kind, release_label, expected_sha256, npis, members)
    digest = hashlib.sha256()
    # Use one descriptor for verification and ZIP reading; do not reopen a replaced path.
    with open(archive, "rb") as handle:
        before = os.fstat(handle.fileno())
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
        if digest.hexdigest() != expected_sha256.lower():
            raise ValueError("Archive SHA-256 mismatch")
        handle.seek(0)
        result = {"format_version": "nppes-v2-extract-1", "bulk_version": "2", "npis": npis, "files": []}
        total = 0
        selected_bytes = 0
        csv.field_size_limit(4 * 1024 * 1024)
        with zipfile.ZipFile(handle) as bundle:
            names = bundle.namelist()
            for kind, member in members:
                if names.count(member) != 1 or not member.lower().endswith((".csv", ".xlsx")):
                    raise ValueError("Member must identify exactly one CSV or deactivation XLSX entry")
                rows = []
                context = {"rows_scanned": 0}
                with bundle.open(member) as binary:
                    hashing = HashReader(binary)
                    for row in native_rows(hashing, member, kind, context):
                        context["rows_scanned"] += 1
                        if row["NPI"] in npis:
                            selected_bytes += len(json.dumps(row, ensure_ascii=False).encode())
                            if selected_bytes > MAX_BYTES:
                                raise ValueError("Subset exceeds 1 MiB; narrow NPI selection")
                            rows.append(row)
                            total += 1
                            if total > 1000:
                                raise ValueError("Subset exceeds 1000 rows; narrow NPI selection")
                    member_hash = hashing.digest.hexdigest()
                result["files"].append({"kind": kind, "source_url": source_url, "release_kind": release_kind,
                                        "release_label": release_label, "archive_sha256": digest.hexdigest(),
                                        "member": member, "member_sha256": member_hash, "complete_scan": True, "extraction": context, "rows": rows})
                if len(json.dumps(result, ensure_ascii=False).encode()) > MAX_BYTES:
                    raise ValueError("Subset exceeds 1 MiB; narrow NPI/member selection")
        after = os.fstat(handle.fileno())
        if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns):
            raise ValueError("Archive changed during extraction")
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--expected-sha256", required=True)
    parser.add_argument("--source-url", required=True)
    parser.add_argument("--release-kind", required=True, choices=["monthly_snapshot", "weekly_incremental", "deactivation"])
    parser.add_argument("--release-label", required=True)
    parser.add_argument("--member", action="append", required=True, help="kind=exact.csv (or deactivations=exact.xlsx); repeat for reference files")
    parser.add_argument("--npi", action="append", required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    members = [item.split("=", 1) for item in args.member]
    if any(len(item) != 2 for item in members):
        parser.error("--member must be kind=exact.csv")
    result = extract(args.archive, args.expected_sha256, args.source_url, args.release_kind, args.release_label, members, args.npi)
    # Publish only a fully scanned packet and never replace an existing result.
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=args.out.parent, delete=False) as output:
        temporary = Path(output.name)
        json.dump(result, output, ensure_ascii=False, separators=(",", ":"))
    try:
        os.link(temporary, args.out)
    finally:
        temporary.unlink()


if __name__ == "__main__":
    main()
