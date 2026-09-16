"""add processing_error to meetings

Revision ID: bf75c6301c6e
Revises: 7d1918a0a580
Create Date: 2026-09-16 23:50:53.130544

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'bf75c6301c6e'
down_revision: Union[str, None] = '7d1918a0a580'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "meetings",
        sa.Column("processing_error", sa.Text(), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("meetings", "processing_error")
