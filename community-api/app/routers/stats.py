"""Stats 路由 - 社区统计 (带 5 分钟内存缓存)"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func, select, distinct
from sqlalchemy.ext.asyncio import AsyncSession

from app.cache import stats_cache
from app.database import get_db
from app.models import CommunityTrace
from app.schemas import ApiResponse, StatsResponse

router = APIRouter(prefix="/api/stats", tags=["stats"])


@router.get("", response_model=ApiResponse)
async def get_stats(db: AsyncSession = Depends(get_db)):
    # 缓存命中
    cached = stats_cache.get()
    if cached is not None:
        return ApiResponse(ok=True, data=cached, meta={"cached": True})

    # 基础统计
    total_q = await db.execute(select(func.count(CommunityTrace.id)))
    total_traces = total_q.scalar() or 0

    contributors_q = await db.execute(
        select(func.count(distinct(CommunityTrace.contributor)))
    )
    total_contributors = contributors_q.scalar() or 0

    success_q = await db.execute(
        select(func.count(CommunityTrace.id)).where(CommunityTrace.success == True)
    )
    success_count = success_q.scalar() or 0
    success_rate = round(success_count / total_traces * 100, 1) if total_traces > 0 else 0

    # 平均值
    avg_q = await db.execute(
        select(func.avg(CommunityTrace.duration), func.avg(CommunityTrace.turn_count))
    )
    avg_row = avg_q.one()
    avg_duration = round(float(avg_row[0] or 0), 1)
    avg_turns = round(float(avg_row[1] or 0), 1)

    # Provider 分布
    provider_q = await db.execute(
        select(CommunityTrace.provider, func.count(CommunityTrace.id))
        .group_by(CommunityTrace.provider)
    )
    provider_distribution = dict(provider_q.all())

    # Model 分布
    model_q = await db.execute(
        select(CommunityTrace.model, func.count(CommunityTrace.id))
        .group_by(CommunityTrace.model)
    )
    model_distribution = dict(model_q.all())

    # 最近 24 小时
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    recent_q = await db.execute(
        select(func.count(CommunityTrace.id)).where(CommunityTrace.uploaded_at >= cutoff)
    )
    recent_24h = recent_q.scalar() or 0

    stats = StatsResponse(
        total_traces=total_traces,
        total_contributors=total_contributors,
        success_rate=success_rate,
        provider_distribution=provider_distribution,
        model_distribution=model_distribution,
        avg_duration=avg_duration,
        avg_turns=avg_turns,
        recent_24h=recent_24h,
    ).model_dump()

    stats_cache.set(stats)

    return ApiResponse(ok=True, data=stats, meta={"cached": False})
