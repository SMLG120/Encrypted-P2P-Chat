"""Add group room names

Revision ID: 004
Revises: 003
Create Date: 2026-05-19
"""

from alembic import op
import sqlalchemy as sa

revision = "004"
down_revision = "003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("rooms", sa.Column("name", sa.String(length=128), nullable=True))


def downgrade() -> None:
    op.drop_column("rooms", "name")
