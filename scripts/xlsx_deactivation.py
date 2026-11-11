"""Read the observed CMS deactivation workbook without coercing text dates/NPIs."""
import io
import posixpath
import re
import xml.etree.ElementTree as ET
import zipfile

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"


class CheckedXml:
    def __init__(self, stream):
        self.stream = stream
        self.tail = b""

    def read(self, size=-1):
        block = self.stream.read(size)
        combined = self.tail + block
        if b"<!DOCTYPE" in combined or b"<!ENTITY" in combined or b"\x00" in block:
            raise ValueError("Unsupported worksheet XML declaration or encoding")
        self.tail = combined[-16:]
        return block


def text_value(element):
    return "".join(part.text or "" for part in [*element.findall(NS + "t"), *element.findall(NS + "r/" + NS + "t")])


def deactivation_cells(element, number, shared):
    values = {}
    for cell in element:
        match = re.fullmatch(r"([A-Z]{1,3})([1-9][0-9]*)", cell.get("r", ""))
        if cell.tag != NS + "c" or not match or int(match[2]) != number or cell.find(NS + "f") is not None:
            raise ValueError("Unexpected cell reference or formula in deactivation workbook")
        column = 0
        for letter in match[1]:
            column = column * 26 + ord(letter) - 64
        if column in values or column > 100:
            raise ValueError("Duplicate or excessive deactivation columns")
        if cell.get("t") == "s":
            index = cell.findtext(NS + "v", "")
            if not index.isdigit() or int(index) >= len(shared):
                raise ValueError("Invalid shared-string index")
            value = shared[int(index)]
        elif cell.get("t") == "inlineStr":
            inline = cell.find(NS + "is")
            if inline is None:
                raise ValueError("Invalid inline-string cell")
            value = text_value(inline)
        else:
            raise ValueError("Expected native text cells; numeric/date/error coercion is unsupported")
        values[column] = value
    width = max(values, default=0)
    cells = [values.get(i, "") for i in range(1, width + 1)]
    return width, cells


def deactivation_layout(book):
    names = book.namelist()
    if len(set(names)) != len(names) or sum(i.file_size for i in book.infolist()) > 256 * 1024 * 1024:
        raise ValueError("Ambiguous or oversized deactivation workbook")
    def xml(name, maximum=16 * 1024 * 1024):
        if book.getinfo(name).file_size > maximum:
            raise ValueError("Workbook XML exceeds bound")
        data = book.read(name)
        if b"<!DOCTYPE" in data or b"<!ENTITY" in data or b"\x00" in data:
            raise ValueError("Workbook XML declarations are unsupported")
        return ET.fromstring(data)

    sheets = xml("xl/workbook.xml").find(NS + "sheets")
    if sheets is None or len(sheets) != 1 or sheets[0].get("name") != "DeactivatedNPIs":
        raise ValueError("Expected the single DeactivatedNPIs worksheet")
    relationships = xml("xl/_rels/workbook.xml.rels")
    matches = [r for r in relationships if r.get("Id") == sheets[0].get(REL + "id")]
    if len(matches) != 1 or matches[0].get("TargetMode") == "External":
        raise ValueError("Invalid deactivation worksheet relationship")
    target = posixpath.normpath(posixpath.join("xl", matches[0].get("Target", "")))
    if not re.fullmatch(r"xl/worksheets/[A-Za-z0-9_.-]+\.xml", target):
        raise ValueError("Invalid deactivation worksheet path")
    shared = [text_value(item) for item in xml("xl/sharedStrings.xml")]
    if book.getinfo(target).file_size > 128 * 1024 * 1024:
        raise ValueError("Deactivation worksheet exceeds 128 MiB")
    return target, shared


def deactivation_rows(raw, context):
    """Yield every native row; unsupported layouts/types fail the entire scan."""
    with zipfile.ZipFile(io.BytesIO(raw)) as book:
        target, shared = deactivation_layout(book)
        context.update({"format": "xlsx", "worksheet": "DeactivatedNPIs", "header_row": 2,
                        "cell_representation": "native text; absent cells are empty strings; no date or number coercion"})
        headers = None
        previous = 0
        with book.open(target) as stream:
            # The bounded worksheet is streamed; remove completed rows from sheetData.
            stack = []
            for event, element in ET.iterparse(CheckedXml(stream), events=("start", "end")):
                if event == "start":
                    stack.append(element)
                    continue
                if element.tag == NS + "row":
                    number = int(element.get("r", "0"))
                    if number <= previous:
                        raise ValueError("Non-advancing deactivation worksheet rows")
                    previous = number
                    width, cells = deactivation_cells(element, number, shared)
                    if number == 1:
                        if len(cells) != 1 or not cells[0].startswith("NPPES Deactivated Records as of "):
                            raise ValueError("Unexpected deactivation title row")
                        context["title"] = cells[0]
                    elif number == 2:
                        headers = cells
                        if "title" not in context or "NPI" not in headers or "NPPES Deactivation Date" not in headers or len(set(headers)) != len(headers) or any(not h for h in headers):
                            raise ValueError("Unexpected deactivation headers")
                        context["headers"] = headers
                    else:
                        if headers is None or width > len(headers):
                            raise ValueError("Unexpected deactivation row width")
                        row = dict(zip(headers, cells + [""] * (len(headers) - width)))
                        if not re.fullmatch(r"\d{10}", row["NPI"]):
                            raise ValueError("Invalid deactivation NPI")
                        yield row
                    stack[-2].remove(element)
                stack.pop()
        if headers is None:
            raise ValueError("Deactivation workbook has no headers")
