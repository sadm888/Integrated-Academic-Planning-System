"""
storage.py — swappable file storage backend.

Defaults to local disk (today's behavior — fine for a single instance). Set
S3_BUCKET (plus the usual AWS credential env vars, or S3_ENDPOINT_URL for an
S3-compatible service like Cloudflare R2) to store files remotely instead.

This isn't just a future-scaling nicety: if PDF indexing runs on a separate
Celery worker instance (see celery_app.py / ai_routes._dispatch_index_pdf),
that worker doesn't share a filesystem with whichever web instance saved the
upload — without S3 configured, indexing on a genuinely separate worker
instance will fail to find the file. Fine as long as the worker runs on the
same machine/volume as the web process; required once it doesn't.

Usage:
  ref = save_file(local_path, key)      # after writing a file locally
  ...  store `ref` wherever you used to store a bare filename ...
  local = resolve_local(ref, fallback_dir, fallback_name)  # before reading it
  delete_file(ref, fallback_dir, fallback_name)
"""
import os
import logging

logger = logging.getLogger(__name__)


def _bucket() -> str:
    return os.environ.get('S3_BUCKET', '').strip()


def _client():
    import boto3
    kwargs = {}
    endpoint = os.environ.get('S3_ENDPOINT_URL', '').strip()
    if endpoint:
        kwargs['endpoint_url'] = endpoint
    return boto3.client('s3', **kwargs)


def save_file(local_path: str, key: str) -> str:
    """Call after writing a file to local_path. Returns a storage reference to
    persist in place of a bare filename: the local path unchanged when S3 isn't
    configured, or 's3://bucket/key' after uploading and removing the local copy."""
    bucket = _bucket()
    if not bucket:
        return local_path
    try:
        _client().upload_file(local_path, bucket, key)
        os.remove(local_path)
        return f's3://{bucket}/{key}'
    except Exception:
        logger.exception(f"S3 upload failed for {key} — leaving file on local disk")
        return local_path


def resolve_local(ref: str, fallback_dir: str, fallback_name: str) -> str:
    """Return a local filesystem path for `ref`, downloading from S3 first if needed.
    `fallback_dir`/`fallback_name` handle records written before this field held a
    full reference (when `ref` is just a bare filename)."""
    if not ref:
        return os.path.join(fallback_dir, fallback_name)
    if ref.startswith('s3://'):
        bucket, key = ref[len('s3://'):].split('/', 1)
        local_path = os.path.join(fallback_dir, os.path.basename(key))
        if not os.path.exists(local_path):
            os.makedirs(fallback_dir, exist_ok=True)
            _client().download_file(bucket, key, local_path)
        return local_path
    if os.path.isabs(ref) or os.path.exists(ref):
        return ref
    return os.path.join(fallback_dir, ref)  # legacy bare-filename record


def delete_file(ref: str, fallback_dir: str, fallback_name: str):
    if not ref:
        ref = fallback_name
    if ref.startswith('s3://'):
        bucket, key = ref[len('s3://'):].split('/', 1)
        try:
            _client().delete_object(Bucket=bucket, Key=key)
        except Exception:
            logger.exception(f"S3 delete failed for {ref}")
        return
    local_path = ref if (os.path.isabs(ref) or os.path.exists(ref)) else os.path.join(fallback_dir, ref)
    try:
        if os.path.exists(local_path):
            os.remove(local_path)
    except OSError:
        pass
