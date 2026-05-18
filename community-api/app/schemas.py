"""Pydantic 请求/响应模型"""
from __future__ import annotations

import re
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field, field_validator

# 合法碱基字符
_BASE_RE = re.compile(r"^[EPVX]+$")


# ========== 请求模型 ==========

class TraceCreate(BaseModel):
    """上传单条 trace 的请求体"""
    id: str = Field(..., min_length=1, max_length=64)
    base_sequence: str = Field(..., min_length=1, max_length=4096)
    base_distribution: dict[str, int] = Field(...)
    model: str = Field(..., min_length=1, max_length=128)
    provider: str = Field(..., min_length=1, max_length=64)
    success: bool
    duration: int = Field(..., ge=0)
    turn_count: int = Field(..., ge=1)
    tool_count: int = Field(..., ge=0)
    error_count: int = Field(0, ge=0)
    tags: list[str] = Field(default_factory=list, max_length=20)
    error_positions: list[int] = Field(default_factory=list)
    contributor: str = Field("anonymous", max_length=128)
    source_token: str = Field(..., min_length=1, max_length=64)
    idempotency_key: str | None = Field(None, max_length=128)

    @field_validator("base_sequence")
    @classmethod
    def validate_base_sequence(cls, v: str) -> str:
        if not _BASE_RE.match(v):
            raise ValueError("base_sequence 只能包含 E, P, V, X 字符")
        return v

    @field_validator("base_distribution")
    @classmethod
    def validate_distribution(cls, v: dict[str, int]) -> dict[str, int]:
        allowed = {"E", "P", "V", "X"}
        if not set(v.keys()).issubset(allowed):
            raise ValueError(f"base_distribution 的 key 只能是 {allowed}")
        if any(val < 0 for val in v.values()):
            raise ValueError("base_distribution 的值不能为负数")
        return v

    @field_validator("tags")
    @classmethod
    def validate_tags(cls, v: list[str]) -> list[str]:
        return [t.strip().lower()[:50] for t in v if t.strip()][:20]


class TraceBatchCreate(BaseModel):
    """批量上传请求体"""
    traces: list[TraceCreate] = Field(..., min_length=1, max_length=50)


# TraceValidate 复用 TraceCreate，仅语义不同 (dry-run 预验证)
TraceValidate = TraceCreate


# ========== 响应模型 ==========

class TraceResponse(BaseModel):
    """单条 trace 返回"""
    id: str
    base_sequence: str
    base_distribution: dict[str, int]
    model: str
    provider: str
    success: bool
    duration: int
    turn_count: int
    tool_count: int
    error_count: int
    tags: list[str]
    error_positions: list[int]
    contributor: str
    source_token: str
    uploaded_at: datetime

    model_config = {"from_attributes": True}


class PaginationMeta(BaseModel):
    """分页元信息"""
    total: int
    page: int
    per_page: int
    total_pages: int


class StatsResponse(BaseModel):
    """社区统计数据"""
    total_traces: int
    total_contributors: int
    success_rate: float
    provider_distribution: dict[str, int]
    model_distribution: dict[str, int]
    avg_duration: float
    avg_turns: float
    recent_24h: int


# ========== 统一响应信封 ==========

class ApiResponse(BaseModel):
    """统一响应信封"""
    ok: bool
    data: Any = None
    error: dict | None = None
    meta: dict | None = None
