"""
Attachment storage backend tests.

Covers both the local-disk backend (default, used by Docker Compose) and
the S3-compatible backend (mocked via moto — no real AWS/R2 credentials
needed). These exercise the storage layer directly, independent of the
message/attachment HTTP flow already covered in test_messages.py.
"""

import pytest
from moto import mock_aws

from app.core.attachment_storage import (
    LocalAttachmentStorage,
    S3AttachmentStorage,
    get_attachment_storage,
)
from app.core.config import settings


@pytest.mark.asyncio
async def test_local_storage_round_trip(tmp_path):
    storage = LocalAttachmentStorage(str(tmp_path))
    await storage.save("a.bin", b"hello-local")
    assert await storage.load("a.bin") == b"hello-local"


@pytest.mark.asyncio
async def test_local_storage_missing_key_returns_none(tmp_path):
    storage = LocalAttachmentStorage(str(tmp_path))
    assert await storage.load("does-not-exist.bin") is None


@pytest.mark.asyncio
async def test_get_attachment_storage_returns_local_by_default(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "ATTACHMENT_STORAGE_BACKEND", "local")
    monkeypatch.setattr(settings, "ATTACHMENT_STORAGE_DIR", str(tmp_path))
    storage = get_attachment_storage()
    assert isinstance(storage, LocalAttachmentStorage)


@pytest.mark.asyncio
async def test_s3_storage_round_trip():
    with mock_aws():
        import boto3

        boto3.client("s3", region_name="us-east-1").create_bucket(Bucket="test-attachments")
        storage = S3AttachmentStorage(
            bucket="test-attachments",
            region="us-east-1",
            endpoint_url=None,
            access_key_id="testing",
            secret_access_key="testing",
        )
        await storage.save("b.bin", b"hello-s3")
        assert await storage.load("b.bin") == b"hello-s3"


@pytest.mark.asyncio
async def test_s3_storage_missing_key_returns_none():
    with mock_aws():
        import boto3

        boto3.client("s3", region_name="us-east-1").create_bucket(Bucket="test-attachments")
        storage = S3AttachmentStorage(
            bucket="test-attachments",
            region="us-east-1",
            endpoint_url=None,
            access_key_id="testing",
            secret_access_key="testing",
        )
        assert await storage.load("missing.bin") is None


@pytest.mark.asyncio
async def test_get_attachment_storage_returns_s3_when_configured(monkeypatch):
    monkeypatch.setattr(settings, "ATTACHMENT_STORAGE_BACKEND", "s3")
    monkeypatch.setattr(settings, "S3_BUCKET", "test-attachments")
    monkeypatch.setattr(settings, "S3_ACCESS_KEY_ID", "testing")
    monkeypatch.setattr(settings, "S3_SECRET_ACCESS_KEY", "testing")
    with mock_aws():
        storage = get_attachment_storage()
        assert isinstance(storage, S3AttachmentStorage)
