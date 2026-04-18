"""utils/encryption.py — AES-256-GCM at-rest encryption for chat and DM messages.

Key derivation:
  - Uses ENCRYPTION_KEY env var (32-byte hex) if set.
  - Otherwise derives a 256-bit key from JWT_SECRET via SHA-256.

Encrypted payload stored in MongoDB:
  {'e': 1, 'ct': '<base64 ciphertext+tag>', 'iv': '<base64 96-bit IV>'}

Usage:
  from utils.encryption import encrypt_text, decrypt_text, is_encrypted

  # Before insert:
  msg['text'] = encrypt_text(plain_text)   # returns dict or None

  # In serialiser:
  text = decrypt_text(msg['text'])          # handles str, dict, or None
"""

import os
import base64
import hashlib
import logging

logger = logging.getLogger(__name__)


def _get_key() -> bytes:
    """Return 32-byte AES key. Prefers ENCRYPTION_KEY env var; falls back to JWT_SECRET."""
    hex_key = os.getenv('ENCRYPTION_KEY', '').strip()
    if hex_key:
        raw = bytes.fromhex(hex_key)
        if len(raw) != 32:
            raise ValueError('ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)')
        return raw
    secret = os.getenv('JWT_SECRET', 'dev-secret-change-in-production')
    return hashlib.sha256(secret.encode('utf-8')).digest()


def encrypt_text(plaintext: str | None) -> dict | None:
    """
    Encrypt a string with AES-256-GCM. Returns an encrypted payload dict,
    or None if plaintext is None/empty.
    """
    if not plaintext:
        return None
    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        key = _get_key()
        iv  = os.urandom(12)   # 96-bit IV — recommended for GCM
        ct  = AESGCM(key).encrypt(iv, plaintext.encode('utf-8'), None)
        return {
            'e':  1,
            'ct': base64.b64encode(ct).decode('ascii'),
            'iv': base64.b64encode(iv).decode('ascii'),
        }
    except Exception:
        logger.exception('encrypt_text failed — storing plaintext as fallback')
        return plaintext   # type: ignore[return-value]  # graceful degradation


def decrypt_text(value) -> str | None:
    """
    Decrypt an encrypted payload dict → plaintext str.
    Passes through plain strings unchanged (backwards compatibility).
    Returns None for None input.
    """
    if value is None:
        return None
    if isinstance(value, str):
        return value   # legacy unencrypted message
    if not isinstance(value, dict) or value.get('e') != 1:
        return str(value)   # unexpected shape — return as string
    try:
        from cryptography.hazmat.primitives.ciphers.aead import AESGCM
        key = _get_key()
        ct  = base64.b64decode(value['ct'])
        iv  = base64.b64decode(value['iv'])
        return AESGCM(key).decrypt(iv, ct, None).decode('utf-8')
    except Exception:
        logger.exception('decrypt_text failed')
        return '[decryption error]'


def is_encrypted(value) -> bool:
    """Return True if value is an encrypted payload dict."""
    return isinstance(value, dict) and value.get('e') == 1
