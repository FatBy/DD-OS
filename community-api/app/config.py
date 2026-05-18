"""应用配置 - 从环境变量 / .env 读取"""
from __future__ import annotations

import json
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://community:changeme@localhost:5432/duncrew_community"
    rate_limit_per_minute: int = 30
    cors_origins: str = '["https://duncrew.com","http://localhost:5173"]'
    valid_source_tokens: str = '["duncrew_community_v1","open_community_v1"]'
    stats_cache_ttl: int = 300  # 5 分钟

    @property
    def cors_origins_list(self) -> list[str]:
        return json.loads(self.cors_origins)

    @property
    def valid_tokens(self) -> list[str]:
        return json.loads(self.valid_source_tokens)

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
