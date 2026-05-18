"""SQLAlchemy ORM 模型"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Integer, String, Text, Index, JSON
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class CommunityTrace(Base):
    """社区碱基序列 - 核心数据表"""

    __tablename__ = "community_traces"

    # --- 主键 ---
    id: Mapped[str] = mapped_column(String(64), primary_key=True)

    # --- 碱基数据 ---
    base_sequence: Mapped[str] = mapped_column(Text, nullable=False)
    base_distribution: Mapped[dict] = mapped_column(JSON, nullable=False)

    # --- 执行元信息 ---
    model: Mapped[str] = mapped_column(String(128), nullable=False)
    provider: Mapped[str] = mapped_column(String(64), nullable=False)
    success: Mapped[bool] = mapped_column(Boolean, nullable=False)
    duration: Mapped[int] = mapped_column(Integer, nullable=False)  # ms
    turn_count: Mapped[int] = mapped_column(Integer, nullable=False)
    tool_count: Mapped[int] = mapped_column(Integer, nullable=False)
    error_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    # --- 标签 & 错误位置 (JSON 数组, 兼容 SQLite 和 PostgreSQL) ---
    tags: Mapped[list] = mapped_column(JSON, default=list)
    error_positions: Mapped[list] = mapped_column(JSON, default=list)

    # --- 来源标识 ---
    source_token: Mapped[str] = mapped_column(String(64), nullable=False)
    idempotency_key: Mapped[str | None] = mapped_column(String(128), nullable=True, unique=True)

    # --- 元数据 ---
    contributor: Mapped[str] = mapped_column(String(128), nullable=False, default="anonymous")
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    client_ip: Mapped[str | None] = mapped_column(String(45), nullable=True)

    __table_args__ = (
        Index("ix_traces_uploaded_at", "uploaded_at"),
        Index("ix_traces_provider", "provider"),
        Index("ix_traces_model", "model"),
        Index("ix_traces_success", "success"),
        Index("ix_traces_source_token", "source_token"),
    )
