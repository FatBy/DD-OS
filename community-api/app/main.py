"""DunCrew Community API - Base Sequence Data Exchange Community Backend"""
from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from app.config import settings
from app.database import init_db
from app.dependencies import RateLimitMiddleware
from app.routers import stats, traces
from app.schemas import ApiResponse


@asynccontextmanager
async def lifespan(app: FastAPI):
    """App lifespan - create tables on startup"""
    await init_db()
    yield


app = FastAPI(
    title="DunCrew Community API",
    description="Base Sequence Data Exchange Community - Agent-friendly trace data API",
    version="0.1.0",
    lifespan=lifespan,
)

# --- Rate Limiting Middleware (IP-based, POST /api/* only) ---
app.add_middleware(RateLimitMiddleware, calls_per_minute=settings.rate_limit_per_minute)

# --- CORS ---
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
    expose_headers=["X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset"],
)


# --- Global Exception Handlers ---
@app.exception_handler(ValidationError)
async def validation_error_handler(request: Request, exc: ValidationError):
    errors = exc.errors()
    return JSONResponse(
        status_code=422,
        content=ApiResponse(
            ok=False,
            error={
                "code": "VALIDATION_ERROR",
                "message": "Request data validation failed",
                "details": [
                    {
                        "field": ".".join(str(loc) for loc in e["loc"]),
                        "message": e["msg"],
                        "type": e["type"],
                    }
                    for e in errors
                ],
                "hint": "Use POST /api/traces/validate to pre-check data format",
            },
        ).model_dump(),
    )


@app.exception_handler(Exception)
async def general_error_handler(request: Request, exc: Exception):
    return JSONResponse(
        status_code=500,
        content=ApiResponse(
            ok=False,
            error={
                "code": "INTERNAL_ERROR",
                "message": "Internal server error",
            },
        ).model_dump(),
    )


# --- Register Routers ---
app.include_router(traces.router)
app.include_router(stats.router)


# --- Health Check ---
@app.get("/api/health")
async def health():
    return ApiResponse(ok=True, data={"status": "healthy", "version": "0.1.0"})


# --- Root ---
@app.get("/")
async def root():
    return {
        "name": "DunCrew Community API",
        "version": "0.1.0",
        "docs": "/docs",
        "endpoints": {
            "traces": "/api/traces",
            "traces_validate": "/api/traces/validate",
            "traces_batch": "/api/traces/batch",
            "traces_export": "/api/traces/export/ndjson",
            "stats": "/api/stats",
            "health": "/api/health",
        },
    }
