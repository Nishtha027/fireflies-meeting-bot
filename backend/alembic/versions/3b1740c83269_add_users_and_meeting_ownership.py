"""add users and meeting ownership

Revision ID: 3b1740c83269
Revises: de173a3f5e02
Create Date: 2026-09-13 00:00:00.000000

Replaces the single-admin-account model (admin_account, a hardcoded
singleton row) with real multi-user support: an open `users` table, plus a
nullable `meetings.user_id` so existing pre-multi-user meetings stay valid
(ownerless) until explicitly assigned - see the auth feature's final report
for how legacy rows were actually handled.

The old global UNIQUE(platform, native_meeting_id) on meetings becomes
UNIQUE(user_id, platform, native_meeting_id): two different users can each
independently capture "the same" external meeting link (e.g. a recurring
standup) as their own separate, privately-owned row.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '3b1740c83269'
down_revision: Union[str, None] = 'de173a3f5e02'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("email", sa.String(), nullable=False),
        sa.Column("password_hash", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email", name="uq_users_email"),
    )
    op.create_index("ix_users_email", "users", ["email"])

    op.add_column("meetings", sa.Column("user_id", sa.Integer(), nullable=True))
    op.create_foreign_key(
        "fk_meetings_user_id_users",
        "meetings",
        "users",
        ["user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.drop_constraint("uq_meetings_platform_native_id", "meetings", type_="unique")
    op.create_unique_constraint(
        "uq_meetings_user_platform_native_id",
        "meetings",
        ["user_id", "platform", "native_meeting_id"],
    )

    op.drop_table("admin_account")


def downgrade() -> None:
    op.create_table(
        "admin_account",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(), nullable=False),
        sa.Column("email", sa.String(), nullable=False),
        sa.Column("password_hash", sa.String(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.CheckConstraint("id = 1", name="ck_admin_account_singleton"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("email", name="uq_admin_account_email"),
    )

    op.drop_constraint("uq_meetings_user_platform_native_id", "meetings", type_="unique")
    op.create_unique_constraint(
        "uq_meetings_platform_native_id", "meetings", ["platform", "native_meeting_id"]
    )
    op.drop_constraint("fk_meetings_user_id_users", "meetings", type_="foreignkey")
    op.drop_column("meetings", "user_id")

    op.drop_index("ix_users_email", table_name="users")
    op.drop_table("users")
