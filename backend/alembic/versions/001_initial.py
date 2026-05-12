"""Initial schema

Revision ID: 001
Create Date: 2024-01-01
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Users
    op.create_table(
        "users",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("username", sa.String(64), unique=True, nullable=False),
        sa.Column("display_name", sa.String(128), nullable=False),
        sa.Column("avatar_url", sa.String(512), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), onupdate=sa.func.now()),
    )
    op.create_index("ix_users_username", "users", ["username"])

    # WebAuthn credentials
    op.create_table(
        "webauthn_credentials",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("credential_id", sa.LargeBinary, unique=True, nullable=False),
        sa.Column("public_key", sa.LargeBinary, nullable=False),
        sa.Column("sign_count", sa.Integer, nullable=False, default=0),
        sa.Column("transports", sa.String(128), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )
    op.create_index("ix_webauthn_credentials_user_id", "webauthn_credentials", ["user_id"])

    # Identity keys
    op.create_table(
        "identity_keys",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False),
        sa.Column("identity_public_key", sa.String(256), nullable=False),
        sa.Column("signing_public_key", sa.String(256), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # Signed prekeys
    op.create_table(
        "signed_prekeys",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("key_id", sa.Integer, nullable=False),
        sa.Column("public_key", sa.String(256), nullable=False),
        sa.Column("signature", sa.String(512), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("is_active", sa.Boolean, default=True, nullable=False),
    )
    op.create_index("ix_signed_prekeys_user_id", "signed_prekeys", ["user_id"])

    # One-time prekeys
    op.create_table(
        "one_time_prekeys",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("key_id", sa.Integer, nullable=False),
        sa.Column("public_key", sa.String(256), nullable=False),
        sa.Column("is_used", sa.Boolean, default=False, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_one_time_prekeys_user_id", "one_time_prekeys", ["user_id"])
    op.create_index("ix_one_time_prekeys_is_used", "one_time_prekeys", ["is_used"])

    # Rooms
    op.execute("CREATE TYPE room_type AS ENUM ('direct', 'group')")
    op.create_table(
        "rooms",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("type", sa.Enum("direct", "group", name="room_type"), nullable=False, default="direct"),
        sa.Column("created_by", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
    )

    # Memberships
    op.execute("CREATE TYPE membership_role AS ENUM ('owner', 'member')")
    op.create_table(
        "memberships",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("room_id", UUID(as_uuid=True), sa.ForeignKey("rooms.id", ondelete="CASCADE"), nullable=False),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role", sa.Enum("owner", "member", name="membership_role"), nullable=False, default="member"),
        sa.Column("joined_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.UniqueConstraint("room_id", "user_id", name="uq_membership"),
    )
    op.create_index("ix_memberships_room_id", "memberships", ["room_id"])
    op.create_index("ix_memberships_user_id", "memberships", ["user_id"])

    # Messages
    op.execute("CREATE TYPE transport_type AS ENUM ('webrtc', 'websocket', 'stored')")
    op.execute("CREATE TYPE delivery_status AS ENUM ('sending', 'sent', 'delivered', 'read', 'failed')")
    op.create_table(
        "messages",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("room_id", UUID(as_uuid=True), sa.ForeignKey("rooms.id", ondelete="CASCADE"), nullable=False),
        sa.Column("sender_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("recipient_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="SET NULL"), nullable=True),
        sa.Column("ciphertext", sa.Text, nullable=False),
        sa.Column("encrypted_header", sa.Text, nullable=True),
        sa.Column("nonce", sa.Text, nullable=False),
        sa.Column("algorithm", sa.Text, nullable=False, default="AES-256-GCM"),
        sa.Column("transport", sa.Enum("webrtc", "websocket", "stored", name="transport_type"), nullable=False, default="stored"),
        sa.Column("delivery_status", sa.Enum("sending", "sent", "delivered", "read", "failed", name="delivery_status"), nullable=False, default="sent"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now()),
        sa.Column("delivered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("read_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_messages_room_id", "messages", ["room_id"])


def downgrade() -> None:
    op.drop_table("messages")
    op.drop_table("memberships")
    op.drop_table("rooms")
    op.drop_table("one_time_prekeys")
    op.drop_table("signed_prekeys")
    op.drop_table("identity_keys")
    op.drop_table("webauthn_credentials")
    op.drop_table("users")
    op.execute("DROP TYPE IF EXISTS delivery_status")
    op.execute("DROP TYPE IF EXISTS transport_type")
    op.execute("DROP TYPE IF EXISTS membership_role")
    op.execute("DROP TYPE IF EXISTS room_type")
