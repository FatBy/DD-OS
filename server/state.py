"""DunCrew Server - Global State (singletons, locks, managers)"""
from __future__ import annotations

import threading
import sqlite3

from server.browser import BrowserManager
from server.embedding import EmbeddingManager

# 全局数据库连接 (线程安全 WAL 模式)
_db_conn: sqlite3.Connection | None = None
_db_lock = threading.Lock()

# V4: 混合搜索引擎全局实例 (懒初始化)
_hybrid_engine = None  # type: HybridSearchEngine | None
_embedding_engine = None  # type: EmbeddingEngine | None

# Dun frontmatter 读-改-写锁 (防止并发 TOCTOU) - 向后兼容别名
# 实际锁定义在 server.utils 中，这里仅做引用
from server.utils import _dun_frontmatter_lock  # noqa: F401

# 全局管理器单例
_browser_manager = BrowserManager()
_embedding_manager = EmbeddingManager()

# 记忆容量管理常量
_CATEGORY_CAPACITY_LIMITS: dict[str, int] = {
    'preference': 100,
    'project': 100,
    'discovery': 200,
    'uncategorized': 50,
}
_MERGE_BATCH_SIZE = 5
_CAPACITY_CHECK_INTERVAL = 86400  # 24 小时

# V10: Compaction 保真检查配置（被 memory_compaction 模块读取）
# 后端本身不调用 LLM，merge 时：
#   1. 先尝试语义合并（fallback 拼接）
#   2. 用 check_preservation 做实体/句数保留率检查
#   3. 未通过 → 保留原条目不合并（等待下一轮，或由前端触发 LLM 合并）
_COMPACTION_CONFIG: dict[str, float] = {
    'ENTITY_RETENTION_MIN': 0.8,
    'SENTENCE_RETENTION_MIN': 0.6,
    'MAX_OUTPUT_CHARS': 500.0,  # 用 float 方便存同一字典，实际使用时 int()
}
