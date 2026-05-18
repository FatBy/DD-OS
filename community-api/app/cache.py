"""内存缓存 - /api/stats 使用"""
from __future__ import annotations

import time
from typing import Any

from app.config import settings


class StatsCache:
    """简单的 TTL 内存缓存"""

    def __init__(self, ttl: int | None = None):
        self._ttl = ttl or settings.stats_cache_ttl
        self._data: Any = None
        self._expires_at: float = 0

    def get(self) -> Any | None:
        if self._data is not None and time.monotonic() < self._expires_at:
            return self._data
        return None

    def set(self, data: Any) -> None:
        self._data = data
        self._expires_at = time.monotonic() + self._ttl

    def invalidate(self) -> None:
        self._data = None
        self._expires_at = 0


stats_cache = StatsCache()
