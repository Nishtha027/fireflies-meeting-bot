"""add chapters to summaries

Revision ID: 7d1918a0a580
Revises: 3b1740c83269
Create Date: 2026-09-15 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '7d1918a0a580'
down_revision: Union[str, None] = '3b1740c83269'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('summaries', sa.Column('chapters', sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column('summaries', 'chapters')
