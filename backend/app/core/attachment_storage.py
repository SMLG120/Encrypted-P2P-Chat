"""
Attachment blob storage backends.

Attachment blobs are already client-side encrypted before they ever reach
the server (see SECURITY.md) — this module only decides *where* the opaque
encrypted bytes live, not how they're protected. `object_key` is always a
server-generated UUID (see `app.api.messages.upload_attachment`), so neither
backend ever interpolates user input into a filesystem or object path —
there is no path-traversal surface here by construction.

Local disk is the default (and what the Docker Compose stack uses, backed
by a named volume). Set ATTACHMENT_STORAGE_BACKEND=s3 to use any
S3-compatible object store (AWS S3, Cloudflare R2, Supabase Storage's S3
gateway, MinIO) instead — this is required for platforms without a
persistent/shared disk (e.g. most PaaS backend deploys).
"""

from __future__ import annotations

import asyncio
from abc import ABC, abstractmethod
from pathlib import Path

from app.core.config import settings


class AttachmentStorage(ABC):
    @abstractmethod
    async def save(self, object_key: str, data: bytes) -> None: ...

    @abstractmethod
    async def load(self, object_key: str) -> bytes | None:
        """Return the stored bytes, or None if object_key does not exist."""


class LocalAttachmentStorage(AttachmentStorage):
    def __init__(self, storage_dir: str) -> None:
        self._dir = Path(storage_dir)

    def _path(self, object_key: str) -> Path:
        return self._dir / object_key

    async def save(self, object_key: str, data: bytes) -> None:
        def _write() -> None:
            self._dir.mkdir(parents=True, exist_ok=True)
            self._path(object_key).write_bytes(data)

        await asyncio.to_thread(_write)

    async def load(self, object_key: str) -> bytes | None:
        path = self._path(object_key)

        def _read() -> bytes | None:
            if not path.exists():
                return None
            return path.read_bytes()

        return await asyncio.to_thread(_read)


class S3AttachmentStorage(AttachmentStorage):
    """Works with AWS S3 and any S3-compatible endpoint (R2, MinIO, Supabase
    Storage's S3 gateway) by setting S3_ENDPOINT_URL."""

    def __init__(
        self,
        bucket: str,
        region: str,
        endpoint_url: str | None,
        access_key_id: str,
        secret_access_key: str,
    ) -> None:
        import boto3

        self._bucket = bucket
        self._client = boto3.client(
            "s3",
            region_name=region,
            endpoint_url=endpoint_url or None,
            aws_access_key_id=access_key_id,
            aws_secret_access_key=secret_access_key,
        )

    async def save(self, object_key: str, data: bytes) -> None:
        await asyncio.to_thread(
            self._client.put_object,
            Bucket=self._bucket,
            Key=object_key,
            Body=data,
            ContentType="application/octet-stream",
        )

    async def load(self, object_key: str) -> bytes | None:
        from botocore.exceptions import ClientError

        def _get() -> bytes | None:
            try:
                obj = self._client.get_object(Bucket=self._bucket, Key=object_key)
            except ClientError as exc:
                code = exc.response.get("Error", {}).get("Code")
                if code in {"NoSuchKey", "404"}:
                    return None
                raise
            return obj["Body"].read()

        return await asyncio.to_thread(_get)


def get_attachment_storage() -> AttachmentStorage:
    """Constructed fresh per call (cheap: no I/O happens here) so that
    settings changes — e.g. monkeypatching ATTACHMENT_STORAGE_DIR in tests —
    take effect immediately rather than sticking to a cached instance."""
    if settings.ATTACHMENT_STORAGE_BACKEND == "s3":
        assert settings.S3_BUCKET and settings.S3_ACCESS_KEY_ID and settings.S3_SECRET_ACCESS_KEY
        return S3AttachmentStorage(
            bucket=settings.S3_BUCKET,
            region=settings.S3_REGION,
            endpoint_url=settings.S3_ENDPOINT_URL,
            access_key_id=settings.S3_ACCESS_KEY_ID,
            secret_access_key=settings.S3_SECRET_ACCESS_KEY,
        )
    return LocalAttachmentStorage(settings.ATTACHMENT_STORAGE_DIR)
