"""Tests for utils/mime_check.py"""
import io
import pytest
from utils.mime_check import detect_mime, is_dangerous, is_image, _detect


# ---------------------------------------------------------------------------
# Magic byte headers
# ---------------------------------------------------------------------------
PNG_HEADER    = b'\x89PNG\r\n\x1a\n' + b'\x00' * 8
JPEG_HEADER   = b'\xff\xd8\xff' + b'\x00' * 13
GIF87_HEADER  = b'GIF87a' + b'\x00' * 10
GIF89_HEADER  = b'GIF89a' + b'\x00' * 10
PDF_HEADER    = b'%PDF-1.4' + b'\x00' * 8
ZIP_HEADER    = b'PK\x03\x04' + b'\x00' * 12
DOC_HEADER    = b'\xd0\xcf\x11\xe0' + b'\x00' * 12
PE_HEADER     = b'MZ' + b'\x00' * 14
ELF_HEADER    = b'\x7fELF' + b'\x00' * 12
SHELL_HEADER  = b'#!/bin/sh' + b'\x00' * 7
WEBP_HEADER   = b'RIFF' + b'\x00' * 4 + b'WEBP'
WAV_HEADER    = b'RIFF' + b'\x00' * 4 + b'WAVE'
FLAC_HEADER   = b'fLaC' + b'\x00' * 12
MP3_ID3       = b'ID3' + b'\x00' * 13


def stream(data: bytes) -> io.BytesIO:
    return io.BytesIO(data)


class TestDetectMime:
    def test_png(self):
        assert detect_mime(stream(PNG_HEADER)) == 'image/png'

    def test_jpeg(self):
        assert detect_mime(stream(JPEG_HEADER)) == 'image/jpeg'

    def test_gif87(self):
        assert detect_mime(stream(GIF87_HEADER)) == 'image/gif'

    def test_gif89(self):
        assert detect_mime(stream(GIF89_HEADER)) == 'image/gif'

    def test_pdf(self):
        assert detect_mime(stream(PDF_HEADER)) == 'application/pdf'

    def test_zip(self):
        assert detect_mime(stream(ZIP_HEADER)) == 'application/zip'

    def test_doc(self):
        assert detect_mime(stream(DOC_HEADER)) == 'application/msword'

    def test_flac(self):
        assert detect_mime(stream(FLAC_HEADER)) == 'audio/flac'

    def test_mp3_id3(self):
        assert detect_mime(stream(MP3_ID3)) == 'audio/mpeg'

    def test_webp(self):
        assert detect_mime(stream(WEBP_HEADER)) == 'image/webp'

    def test_non_webp_riff_returns_none(self):
        # WAV is RIFF but not WEBP
        assert detect_mime(stream(WAV_HEADER)) is None

    def test_pe_executable(self):
        assert detect_mime(stream(PE_HEADER)) == '__executable__'

    def test_elf_executable(self):
        assert detect_mime(stream(ELF_HEADER)) == '__executable__'

    def test_shell_script(self):
        assert detect_mime(stream(SHELL_HEADER)) == '__script__'

    def test_unknown_returns_none(self):
        assert detect_mime(stream(b'\x00' * 16)) is None

    def test_stream_is_reset_after_read(self):
        s = stream(PNG_HEADER)
        detect_mime(s)
        # stream should be at position 0 after detect_mime
        assert s.tell() == 0


class TestIsDangerous:
    def test_pe_is_dangerous(self):
        assert is_dangerous(stream(PE_HEADER)) is True

    def test_elf_is_dangerous(self):
        assert is_dangerous(stream(ELF_HEADER)) is True

    def test_shell_is_dangerous(self):
        assert is_dangerous(stream(SHELL_HEADER)) is True

    def test_png_is_not_dangerous(self):
        assert is_dangerous(stream(PNG_HEADER)) is False

    def test_pdf_is_not_dangerous(self):
        assert is_dangerous(stream(PDF_HEADER)) is False

    def test_unknown_is_not_dangerous(self):
        assert is_dangerous(stream(b'\x00' * 16)) is False


class TestIsImage:
    def test_png_is_image(self):
        assert is_image(stream(PNG_HEADER)) is True

    def test_jpeg_is_image(self):
        assert is_image(stream(JPEG_HEADER)) is True

    def test_gif_is_image(self):
        assert is_image(stream(GIF89_HEADER)) is True

    def test_webp_is_image(self):
        assert is_image(stream(WEBP_HEADER)) is True

    def test_pdf_is_not_image(self):
        assert is_image(stream(PDF_HEADER)) is False

    def test_exe_is_not_image(self):
        assert is_image(stream(PE_HEADER)) is False

    def test_unknown_is_not_image(self):
        assert is_image(stream(b'\x00' * 16)) is False
