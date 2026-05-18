"""异步数据库连接管理 - 支持 PostgreSQL (生产) 和 SQLite (开发)"""
from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import settings

_url = settings.database_url

# SQLite 需要特殊处理：不支持 pool_size 参数，且需要 aiosqlite 驱动
if _url.startswith("sqlite"):
    engine = create_async_engine(_url, echo=False)
else:
    engine = create_async_engine(_url, pool_size=10, max_overflow=5)

async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


async def get_db():
    """FastAPI 依赖注入 - 获取数据库会话"""
    async with async_session() as session:
        yield session


async def init_db():
    """在应用启动时创建所有表"""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
