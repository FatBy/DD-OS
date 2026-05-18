"""依赖注入 - IP 速率限制中间件 & source_token 校验"""
from __future__ import annotations

import time
from collections import defaultdict

from fastapi import HTTPException, Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from app.config import settings


def validate_source_token(source_token: str) -> str:
    """校验 source_token 是否合法"""
    if source_token not in settings.valid_tokens:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "INVALID_SOURCE_TOKEN",
                "message": f"Invalid source_token. Valid: {settings.valid_tokens}",
                "hint": "Use duncrew_community_v1 or open_community_v1",
            },
        )
    return source_token


def get_client_ip(request: Request) -> str:
    """获取客户端真实 IP (支持反向代理)"""
    forwarded = request.headers.get("X-Forwarded-For")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


class RateLimitMiddleware(BaseHTTPMiddleware):
    """基于 IP 的滑动窗口速率限制中间件 (仅对 POST /api/* 生效)"""

    def __init__(self, app, calls_per_minute: int = 30):
        super().__init__(app)
        self.calls_per_minute = calls_per_minute
        self.window = 60  # seconds
        self._requests: dict[str, list[float]] = defaultdict(list)

    async def dispatch(self, request: Request, call_next):
        path = request.url.path
        if request.method == "POST" and path.startswith("/api/"):
            ip = get_client_ip(request)
            now = time.monotonic()

            # 清除过期记录
            cutoff = now - self.window
            self._requests[ip] = [t for t in self._requests[ip] if t > cutoff]
            timestamps = self._requests[ip]

            if len(timestamps) >= self.calls_per_minute:
                reset_in = int(timestamps[0] + self.window - now)
                return JSONResponse(
                    status_code=429,
                    content={
                        "ok": False,
                        "error": {
                            "code": "RATE_LIMIT_EXCEEDED",
                            "message": f"Rate limit: {self.calls_per_minute} requests/minute",
                            "hint": "Please wait and retry",
                        },
                    },
                    headers={
                        "X-RateLimit-Limit": str(self.calls_per_minute),
                        "X-RateLimit-Remaining": "0",
                        "X-RateLimit-Reset": str(reset_in),
                        "Retry-After": str(reset_in),
                    },
                )

            timestamps.append(now)
            remaining = self.calls_per_minute - len(timestamps)

            response = await call_next(request)
            response.headers["X-RateLimit-Limit"] = str(self.calls_per_minute)
            response.headers["X-RateLimit-Remaining"] = str(remaining)
            return response

        return await call_next(request)
