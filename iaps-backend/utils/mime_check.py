"""
mime_check.py — lightweight magic-bytes MIME detection.

No external dependencies; reads the first 16 bytes of the file stream.
"""

# Signatures: (byte_offset, bytes_to_match) -> mime_type
_SIGNATURES = [
    (0, b'\x89PNG\r\n\x1a\n',    'image/png'),
    (0, b'\xff\xd8\xff',          'image/jpeg'),
    (0, b'GIF87a',                'image/gif'),
    (0, b'GIF89a',                'image/gif'),
    (0, b'%PDF',                  'application/pdf'),
    (0, b'PK\x03\x04',           'application/zip'),
    (0, b'\xd0\xcf\x11\xe0',     'application/msword'),   # legacy .doc/.xls/.ppt
    (0, b'ID3',                   'audio/mpeg'),
    (0, b'\xff\xfb',              'audio/mpeg'),
    (0, b'fLaC',                  'audio/flac'),
    (0, b'\x1aE\xdf\xa3',        'video/webm'),
    (0, b'\x00\x00\x00\x18ftyp', 'video/mp4'),
    (0, b'\x00\x00\x00\x1cftyp', 'video/mp4'),
    # RIFF container (WAV / WEBP / AVI)
    (0, b'RIFF',                  'image/webp'),   # refined below
    # Dangerous executables
    (0, b'MZ',                    '__executable__'),   # Windows PE
    (0, b'\x7fELF',               '__executable__'),   # Linux ELF
    (0, b'#!/',                   '__script__'),        # shell scripts
    (0, b'#! /',                  '__script__'),
]

# WEBP: RIFF....WEBP at offset 8
def _detect(header: bytes) -> str | None:
    for offset, sig, mime in _SIGNATURES:
        if header[offset:offset + len(sig)] == sig:
            if mime == 'image/webp':
                # Distinguish WEBP from WAV/AVI
                if header[8:12] == b'WEBP':
                    return 'image/webp'
                return None  # other RIFF — unknown
            return mime
    return None


def detect_mime(file_stream) -> str | None:
    """Read the first 16 bytes and return a detected MIME type (or None)."""
    header = file_stream.read(16)
    file_stream.seek(0)
    return _detect(header)


def is_dangerous(file_stream) -> bool:
    """Return True if the file has an executable or script signature."""
    mime = detect_mime(file_stream)
    return mime in ('__executable__', '__script__')


def is_image(file_stream) -> bool:
    """Return True if the file is a recognised image format."""
    mime = detect_mime(file_stream)
    return mime in ('image/png', 'image/jpeg', 'image/gif', 'image/webp')
