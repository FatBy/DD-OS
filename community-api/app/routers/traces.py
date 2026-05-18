"""Traces 路由 - 核心 CRUD + 批量 + 验证 + 导出"""
from __future__ import annotations

import json
import math

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import StreamingResponse
from sqlalchemy import cast, func, select, desc, String
from sqlalchemy.ext.asyncio import AsyncSession

from app.cache import stats_cache
from app.database import get_db
from app.dependencies import get_client_ip, validate_source_token
from app.models import CommunityTrace
from app.schemas import (
    ApiResponse,
    PaginationMeta,
    TraceBatchCreate,
    TraceCreate,
    TraceResponse,
    TraceValidate,
)

router = APIRouter(prefix="/api/traces", tags=["traces"])


# ============================================
# POST /api/traces - 上传单条 trace
# ============================================
@router.post("", response_model=ApiResponse)
async def create_trace(
    request: Request,
    body: TraceCreate,
    db: AsyncSession = Depends(get_db),
):
    validate_source_token(body.source_token)
    client_ip = get_client_ip(request)

    # 幂等性检查
    if body.idempotency_key:
        existing = await db.execute(
            select(CommunityTrace.id).where(
                CommunityTrace.idempotency_key == body.idempotency_key
            )
        )
        row = existing.scalar_one_or_none()
        if row is not None:
            return ApiResponse(
                ok=True,
                data={"id": row, "deduplicated": True},
                meta={"message": "idempotency_key already exists, skipped"},
            )

    trace = CommunityTrace(
        id=body.id,
        base_sequence=body.base_sequence,
        base_distribution=body.base_distribution,
        model=body.model,
        provider=body.provider,
        success=body.success,
        duration=body.duration,
        turn_count=body.turn_count,
        tool_count=body.tool_count,
        error_count=body.error_count,
        tags=body.tags,
        error_positions=body.error_positions,
        source_token=body.source_token,
        idempotency_key=body.idempotency_key,
        contributor=body.contributor,
        client_ip=client_ip,
    )

    db.add(trace)
    try:
        await db.commit()
    except Exception:
        await db.rollback()
        return ApiResponse(
            ok=False,
            error={
                "code": "DUPLICATE_ID",
                "message": f"trace id '{body.id}' already exists",
                "hint": "Use a unique id, or use idempotency_key for idempotent uploads",
            },
        )

    stats_cache.invalidate()

    return ApiResponse(ok=True, data={"id": trace.id, "uploaded_at": trace.uploaded_at.isoformat()})


# ============================================
# POST /api/traces/validate - 预验证 (dry-run)
# ============================================
@router.post("/validate", response_model=ApiResponse)
async def validate_trace(body: TraceValidate):
    validate_source_token(body.source_token)
    return ApiResponse(ok=True, data={"valid": True, "message": "Data format is valid, ready to upload"})


# ============================================
# POST /api/traces/batch - 批量上传
# ============================================
@router.post("/batch", response_model=ApiResponse)
async def create_traces_batch(
    request: Request,
    body: TraceBatchCreate,
    db: AsyncSession = Depends(get_db),
):
    client_ip = get_client_ip(request)
    results: list[dict] = []

    for item in body.traces:
        validate_source_token(item.source_token)

        # 幂等性检查
        if item.idempotency_key:
            existing = await db.execute(
                select(CommunityTrace.id).where(
                    CommunityTrace.idempotency_key == item.idempotency_key
                )
            )
            if existing.scalar_one_or_none() is not None:
                results.append({"id": item.id, "status": "skipped", "reason": "duplicate idempotency_key"})
                continue

        trace = CommunityTrace(
            id=item.id,
            base_sequence=item.base_sequence,
            base_distribution=item.base_distribution,
            model=item.model,
            provider=item.provider,
            success=item.success,
            duration=item.duration,
            turn_count=item.turn_count,
            tool_count=item.tool_count,
            error_count=item.error_count,
            tags=item.tags,
            error_positions=item.error_positions,
            source_token=item.source_token,
            idempotency_key=item.idempotency_key,
            contributor=item.contributor,
            client_ip=client_ip,
        )
        db.add(trace)
        try:
            await db.flush()
            results.append({"id": item.id, "status": "created"})
        except Exception:
            await db.rollback()
            results.append({"id": item.id, "status": "failed", "reason": "duplicate id"})

    try:
        await db.commit()
    except Exception:
        await db.rollback()

    stats_cache.invalidate()

    created = sum(1 for r in results if r["status"] == "created")
    return ApiResponse(
        ok=True,
        data=results,
        meta={"total": len(body.traces), "created": created, "skipped": len(body.traces) - created},
    )


# ============================================
# GET /api/traces - 列表查询 (分页 + 过滤)
# ============================================
@router.get("", response_model=ApiResponse)
async def list_traces(
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    provider: str | None = None,
    model: str | None = None,
    success: bool | None = None,
    tag: str | None = None,
    sort: str = Query("newest", pattern="^(newest|oldest|longest|shortest)$"),
    db: AsyncSession = Depends(get_db),
):
    query = select(CommunityTrace)
    count_query = select(func.count(CommunityTrace.id))

    # 过滤
    if provider:
        query = query.where(CommunityTrace.provider == provider)
        count_query = count_query.where(CommunityTrace.provider == provider)
    if model:
        query = query.where(CommunityTrace.model == model)
        count_query = count_query.where(CommunityTrace.model == model)
    if success is not None:
        query = query.where(CommunityTrace.success == success)
        count_query = count_query.where(CommunityTrace.success == success)
    if tag:
        tag_filter = cast(CommunityTrace.tags, String).contains(f'"{tag}"')
        query = query.where(tag_filter)
        count_query = count_query.where(tag_filter)

    # 排序
    order_map = {
        "newest": desc(CommunityTrace.uploaded_at),
        "oldest": CommunityTrace.uploaded_at,
        "longest": desc(CommunityTrace.duration),
        "shortest": CommunityTrace.duration,
    }
    query = query.order_by(order_map.get(sort, desc(CommunityTrace.uploaded_at)))

    # 总数
    total_result = await db.execute(count_query)
    total = total_result.scalar() or 0

    # 分页
    query = query.offset((page - 1) * per_page).limit(per_page)
    result = await db.execute(query)
    traces = result.scalars().all()

    return ApiResponse(
        ok=True,
        data=[TraceResponse.model_validate(t).model_dump(mode="json") for t in traces],
        meta=PaginationMeta(
            total=total,
            page=page,
            per_page=per_page,
            total_pages=math.ceil(total / per_page) if total > 0 else 0,
        ).model_dump(),
    )


# ============================================
# GET /api/traces/export - NDJSON 流式导出
# (必须在 /{trace_id} 之前注册，避免路由冲突)
# ============================================
@router.get("/export/ndjson")
async def export_traces_ndjson(
    provider: str | None = None,
    model: str | None = None,
    success: bool | None = None,
    limit: int = Query(1000, ge=1, le=10000),
    db: AsyncSession = Depends(get_db),
):
    """NDJSON streaming export for Agent consumption"""
    query = select(CommunityTrace).order_by(desc(CommunityTrace.uploaded_at)).limit(limit)
    if provider:
        query = query.where(CommunityTrace.provider == provider)
    if model:
        query = query.where(CommunityTrace.model == model)
    if success is not None:
        query = query.where(CommunityTrace.success == success)

    result = await db.execute(query)
    traces = result.scalars().all()

    async def generate():
        for t in traces:
            line = TraceResponse.model_validate(t).model_dump(mode="json")
            yield json.dumps(line, ensure_ascii=False) + "\n"

    return StreamingResponse(
        generate(),
        media_type="application/x-ndjson",
        headers={"Content-Disposition": "attachment; filename=traces.ndjson"},
    )


# ============================================
# GET /api/traces/:id - 获取单条
# ============================================
@router.get("/{trace_id}", response_model=ApiResponse)
async def get_trace(trace_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(CommunityTrace).where(CommunityTrace.id == trace_id))
    trace = result.scalar_one_or_none()
    if trace is None:
        return ApiResponse(
            ok=False,
            error={
                "code": "NOT_FOUND",
                "message": f"trace '{trace_id}' not found",
                "hint": "Check if the id is correct",
            },
        )
    return ApiResponse(
        ok=True,
        data=TraceResponse.model_validate(trace).model_dump(mode="json"),
    )
