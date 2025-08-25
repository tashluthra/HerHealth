"""add sessions/sets/reps + user role/pass

Revision ID: 35c76eef40df
Revises: 91fe72a41638
Create Date: 2025-08-25 21:41:56.907923

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# define the enum type once so we can create/drop it explicitly
user_role = postgresql.ENUM('user', 'clinician', 'admin', name='user_role')



# revision identifiers, used by Alembic.
revision: str = '35c76eef40df'
down_revision: Union[str, None] = '91fe72a41638'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1) create enum type if it doesn't exist
    user_role.create(op.get_bind(), checkfirst=True)

    # 2) users table changes
    op.add_column('users', sa.Column('password_hash', sa.String(length=255), nullable=False, server_default=''))
    op.add_column('users', sa.Column('role', user_role, nullable=False, server_default='user'))

    # 3) sessions table
    op.create_table(
        'sessions',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('started_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.Column('ended_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('notes', sa.Text(), nullable=True),
    )

    # 4) exercise_sets table
    op.create_table(
        'exercise_sets',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('session_id', sa.Integer(), sa.ForeignKey('sessions.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('exercise', sa.String(length=120), nullable=False),
        sa.Column('target_reps', sa.Integer(), nullable=True),
        sa.Column('weight', sa.Numeric(10, 2), nullable=True),
    )

    # 5) rep_events table
    op.create_table(
        'rep_events',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('set_id', sa.Integer(), sa.ForeignKey('exercise_sets.id', ondelete='CASCADE'), nullable=False, index=True),
        sa.Column('timestamp', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.Column('rep_index', sa.Integer(), nullable=False, server_default='1'),
    )


def downgrade() -> None:
    # drop child tables in reverse order
    op.drop_table('rep_events')
    op.drop_table('exercise_sets')
    op.drop_table('sessions')

    # drop columns from users
    op.drop_column('users', 'role')
    op.drop_column('users', 'password_hash')

    # finally drop enum type
    user_role.drop(op.get_bind(), checkfirst=True)

