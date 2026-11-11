import hashlib
import io
from pathlib import Path
import tempfile
import unittest
from xml.sax.saxutils import escape
import zipfile

from extract_v2 import extract
from xlsx_deactivation import CheckedXml, deactivation_rows

NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main"


def workbook(last_row="", sheet="DeactivatedNPIs", headers=("NPI", "NPPES Deactivation Date")):
    # Minimal format fixture for the parser, not a reader-facing workbook artifact.
    def cell(ref, value):
        return f'<c r="{ref}" t="inlineStr"><is><t>{escape(value)}</t></is></c>'
    rows = '<row r="1">' + cell("A1", "NPPES Deactivated Records as of Sep 14 2026") + '</row>'
    rows += '<row r="2">' + cell("A2", headers[0]) + cell("B2", headers[1]) + '</row>'
    rows += '<row r="3">' + cell("A3", "1730979303") + cell("B3", "09/14/2026") + '</row>'
    rows += last_row
    out = io.BytesIO()
    with zipfile.ZipFile(out, "w") as z:
        z.writestr("xl/workbook.xml", f'<workbook xmlns="{NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="{sheet}" r:id="rId3"/></sheets></workbook>')
        z.writestr("xl/_rels/workbook.xml.rels", '<Relationships><Relationship Id="rId3" Target="worksheets/data.xml"/></Relationships>')
        z.writestr("xl/sharedStrings.xml", f'<sst xmlns="{NS}"><si><t>001</t></si></sst>')
        z.writestr("xl/worksheets/data.xml", f'<worksheet xmlns="{NS}"><sheetData>{rows}</sheetData></worksheet>')
    return out.getvalue()


class DeactivationTests(unittest.TestCase):
    def test_native_text_and_title_are_preserved(self):
        context = {}
        rows = list(deactivation_rows(workbook(), context))
        self.assertEqual(rows, [{"NPI": "1730979303", "NPPES Deactivation Date": "09/14/2026"}])
        self.assertEqual(context["header_row"], 2)
        self.assertEqual(context["title"], "NPPES Deactivated Records as of Sep 14 2026")

    def test_bad_cells_after_the_selected_match_fail(self):
        variants = [
            '<row r="4"><c r="A4"><v>1730979303</v></c></row>',
            '<row r="4"><c r="A4" t="s"><v>999</v></c></row>',
            '<row r="4"><c r="A4" t="s"><f>1+1</f><v>0</v></c></row>',
            '<row r="4"><c r="A4" t="s"><v>0</v></c><c r="A4" t="s"><v>0</v></c></row>',
            '<row r="3"><c r="A3" t="s"><v>0</v></c></row>',
            '<row r="4"><c r="A5" t="s"><v>0</v></c></row>',
        ]
        for last in variants:
            with self.subTest(last=last), self.assertRaises(ValueError):
                list(deactivation_rows(workbook(last), {}))

    def test_wrong_sheet_or_headers_fail(self):
        for kwargs in [{"sheet": "Other"}, {"headers": ("NPI", "NPI")}, {"headers": ("NPI", "Date")}]:
            with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                list(deactivation_rows(workbook(**kwargs), {}))

    def test_xml_declarations_and_alternate_encoding_are_rejected(self):
        for forbidden in [b"<!DOCTYPE", b"<!ENTITY", b"\x00"]:
            reader = CheckedXml(io.BytesIO(b"prefix" + forbidden + b"suffix"))
            with self.subTest(forbidden=forbidden), self.assertRaises(ValueError):
                while reader.read(3):
                    pass
        for name, replacement in [("xl/workbook.xml", '<!DOCTYPE workbook><workbook/>'.encode()),
                                  ("xl/sharedStrings.xml", '<sst/>'.encode('utf-16'))]:
            original = workbook()
            out = io.BytesIO()
            with zipfile.ZipFile(io.BytesIO(original)) as source, zipfile.ZipFile(out, "w") as target:
                for item in source.infolist():
                    target.writestr(item.filename, replacement if item.filename == name else source.read(item))
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, "declaration"):
                list(deactivation_rows(out.getvalue(), {}))

    def test_archive_and_full_workbook_hashes_and_empty_selection(self):
        data = workbook()
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / "fixture.zip"
            with zipfile.ZipFile(archive, "w") as z:
                z.writestr("deactivated.xlsx", data)
            digest = hashlib.sha256(archive.read_bytes()).hexdigest()
            args = [archive, digest, "https://download.cms.gov/nppes/fixture_V2.zip", "deactivation", "Fixture", [("deactivations", "deactivated.xlsx")]]
            selected = extract(*args, ["1730979303"])["files"][0]
            self.assertEqual(selected["member_sha256"], hashlib.sha256(data).hexdigest())
            self.assertEqual(selected["extraction"]["rows_scanned"], 1)
            self.assertEqual(selected["rows"][0]["NPPES Deactivation Date"], "09/14/2026")
            empty = extract(*args, ["1234567893"])["files"][0]
            self.assertEqual(empty["rows"], [])
            self.assertEqual(empty["member_sha256"], selected["member_sha256"])
            with self.assertRaisesRegex(ValueError, "only"):
                extract(*args[:-1], [("providers", "deactivated.xlsx")], ["1730979303"])


if __name__ == "__main__":
    unittest.main()
