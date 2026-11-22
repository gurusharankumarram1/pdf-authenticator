"""Regenerates the test PDFs in this folder. Requires: pip install pymupdf pypdf"""

import io
from pathlib import Path

import fitz
from pypdf import PdfReader, PdfWriter

OUT = Path(__file__).parent


def document() -> fitz.Document:
    doc = fitz.open()
    doc.new_page().insert_text((72, 72), "pdf-authenticator fixture")
    return doc


def save(name: str, **options) -> None:
    doc = document()
    doc.save(OUT / name, **options)
    doc.close()


save("plain.pdf")
save("xref-stream.pdf", use_objstms=1)
save(
    "encrypted-aes256.pdf",
    encryption=fitz.PDF_ENCRYPT_AES_256,
    owner_pw="owner",
    user_pw="user",
)
save(
    "encrypted-rc4.pdf",
    encryption=fitz.PDF_ENCRYPT_RC4_128,
    owner_pw="owner",
    user_pw="user",
)
save(
    "encrypted-xref-stream.pdf",
    use_objstms=1,
    encryption=fitz.PDF_ENCRYPT_AES_256,
    owner_pw="owner",
    user_pw="user",
)

save("incremental.pdf")
doc = fitz.open(OUT / "incremental.pdf")
doc.new_page().insert_text((72, 72), "appended page")
doc.saveIncr()
doc.close()

buffer = io.BytesIO()
document().save(buffer)
writer = PdfWriter(clone_from=PdfReader(buffer))
writer.write(OUT / "pypdf-plain.pdf")
writer.encrypt("user", "owner", algorithm="RC4-128")
writer.write(OUT / "pypdf-encrypted.pdf")
