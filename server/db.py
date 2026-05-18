"""DunCrew Server - Database Initialization and Memory Capacity Management"""
from __future__ import annotations

import json
import time
import uuid
import threading
import sqlite3
from pathlib import Path

from server.constants import HAS_HYBRID_SEARCH
from server.state import (
    _db_lock, _embedding_manager,
    _CATEGORY_CAPACITY_LIMITS, _MERGE_BATCH_SIZE, _CAPACITY_CHECK_INTERVAL,
    _COMPACTION_CONFIG,
)
# V10: 保真检查
try:
    from server.handlers.memory_compaction import (
        check_preservation, fallback_merge,
    )
    _HAS_COMPACTION = True
except Exception:  # pragma: no cover
    _HAS_COMPACTION = False

# 条件导入 hybrid_search 符号
if HAS_HYBRID_SEARCH:
    from hybrid_search import (
        HybridSearchEngine, EmbeddingEngine, OpenAICompatibleEmbeddingEngine,
        ensure_vector_table, index_memory_vectors, reindex_all_memory_vectors,
        reindex_all_wiki_vectors,
    )

def init_sqlite_db(db_path: Path) -> sqlite3.Connection:
    """初始化 SQLite 数据库，创建 V2 所需的表"""
    conn = sqlite3.connect(str(db_path), check_same_thread=False, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")

    conn.executescript("""
        -- 会话表
        CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            title TEXT NOT NULL DEFAULT '',
            type TEXT NOT NULL DEFAULT 'general',
            dun_id TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            last_message_preview TEXT DEFAULT ''
        );

        -- 消息表
        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            role TEXT NOT NULL,
            content TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            metadata TEXT,
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, timestamp);

        -- 检查点表 (断点续作)
        CREATE TABLE IF NOT EXISTS checkpoints (
            session_id TEXT PRIMARY KEY,
            data TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
        );

        -- 记忆表 (FTS5 全文搜索)
        -- V10: 加入 supersede 三态（status / superseded_by / supersede_reason / supersede_at）
        CREATE TABLE IF NOT EXISTS memory (
            id TEXT PRIMARY KEY,
            source TEXT NOT NULL DEFAULT 'ephemeral',
            content TEXT NOT NULL,
            dun_id TEXT,
            tags TEXT DEFAULT '[]',
            metadata TEXT DEFAULT '{}',
            created_at INTEGER NOT NULL,
            deleted_at INTEGER,
            category TEXT DEFAULT 'uncategorized',
            status TEXT NOT NULL DEFAULT 'active',   -- active | superseded | conflicted
            superseded_by TEXT,                      -- 指向新条目的 id（或冲突对方的 id）
            supersede_reason TEXT,                   -- 为何被取代/冲突
            supersede_at INTEGER                     -- 何时被取代/冲突
        );
        CREATE INDEX IF NOT EXISTS idx_memory_source ON memory(source);
        -- 注意：status / superseded_by 索引不在此处创建。
        -- 因为旧库 memory 表不存在这两列，CREATE TABLE IF NOT EXISTS 不会补列，
        -- 在 executescript 内直接建索引会在旧库上报 "no such column: status" 导致启动失败。
        -- 这两个索引改由下方 V10 迁移段在 ALTER TABLE ADD COLUMN 之后创建（幂等）。

        -- FTS5 虚拟表 (全文搜索)
        CREATE VIRTUAL TABLE IF NOT EXISTS memory_fts USING fts5(
            content,
            tags,
            content='memory',
            content_rowid='rowid'
        );

        -- 自动同步 FTS 索引的触发器
        CREATE TRIGGER IF NOT EXISTS memory_ai AFTER INSERT ON memory BEGIN
            INSERT INTO memory_fts(rowid, content, tags)
            VALUES (new.rowid, new.content, new.tags);
        END;
        CREATE TRIGGER IF NOT EXISTS memory_ad AFTER DELETE ON memory BEGIN
            INSERT INTO memory_fts(memory_fts, rowid, content, tags)
            VALUES ('delete', old.rowid, old.content, old.tags);
        END;
        CREATE TRIGGER IF NOT EXISTS memory_au AFTER UPDATE ON memory BEGIN
            INSERT INTO memory_fts(memory_fts, rowid, content, tags)
            VALUES ('delete', old.rowid, old.content, old.tags);
            INSERT INTO memory_fts(rowid, content, tags)
            VALUES (new.rowid, new.content, new.tags);
        END;

        -- 评分表
        CREATE TABLE IF NOT EXISTS dun_scoring (
            dun_id TEXT PRIMARY KEY,
            scoring_data TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        );

        -- ============================================
        -- Wiki 知识图谱 (V8: Entity-Claim-Evidence 三层模型)
        -- ============================================

        -- 概念实体
        CREATE TABLE IF NOT EXISTS wiki_entity (
            id          TEXT PRIMARY KEY,       -- UUID
            dun_id      TEXT,                   -- NULL = 全局实体
            slug        TEXT,                   -- 可读标识 'emotion-consumption'
            title       TEXT NOT NULL,
            type        TEXT NOT NULL DEFAULT 'concept',  -- concept | topic | pattern
            tldr        TEXT,
            tags        TEXT DEFAULT '[]',      -- JSON array
            status      TEXT DEFAULT 'active',  -- active | archived
            created_at  INTEGER NOT NULL,
            updated_at  INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_wiki_entity_dun ON wiki_entity(dun_id);
        CREATE INDEX IF NOT EXISTS idx_wiki_entity_status ON wiki_entity(status);

        -- 原子断言 (挂在 Entity 下)
        CREATE TABLE IF NOT EXISTS wiki_claim (
            id              TEXT PRIMARY KEY,       -- UUID
            entity_id       TEXT NOT NULL REFERENCES wiki_entity(id) ON DELETE CASCADE,
            content         TEXT NOT NULL,           -- 断言内容
            type            TEXT,                    -- metric | insight | pattern | fact
            value           TEXT,                    -- 数值型 claim: '+2.66亿'
            trend           TEXT,                    -- up | down | stable
            confidence      REAL DEFAULT 0.8,
            status          TEXT DEFAULT 'active',   -- active | superseded | conflicted
            conflict_with   TEXT,                    -- 冲突对方的 claim_id
            source_ingest_id TEXT,                   -- 哪次 ingest 创建/更新
            created_at      INTEGER NOT NULL,
            updated_at      INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_wiki_claim_entity ON wiki_claim(entity_id);
        CREATE INDEX IF NOT EXISTS idx_wiki_claim_status ON wiki_claim(status);

        -- 证据/溯源 (挂在 Claim 下)
        CREATE TABLE IF NOT EXISTS wiki_evidence (
            id          TEXT PRIMARY KEY,       -- UUID
            claim_id    TEXT NOT NULL REFERENCES wiki_claim(id) ON DELETE CASCADE,
            source_name TEXT NOT NULL,          -- '《2026全球AI用户报告》'
            chunk_text  TEXT,                   -- 原始文本片段 (nullable, 第一版可不填)
            timestamp   INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_wiki_evidence_claim ON wiki_evidence(claim_id);

        -- 实体间关系
        CREATE TABLE IF NOT EXISTS wiki_relation (
            id          TEXT PRIMARY KEY,       -- UUID
            source_id   TEXT NOT NULL REFERENCES wiki_entity(id) ON DELETE CASCADE,
            target_id   TEXT NOT NULL REFERENCES wiki_entity(id) ON DELETE CASCADE,
            type        TEXT NOT NULL,          -- related_to | contradicts | subtopic_of
            strength    REAL DEFAULT 0.5,       -- 关系强度 0-1
            description TEXT,
            created_at  INTEGER NOT NULL,
            UNIQUE(source_id, target_id, type)
        );
        CREATE INDEX IF NOT EXISTS idx_wiki_relation_source ON wiki_relation(source_id);
        CREATE INDEX IF NOT EXISTS idx_wiki_relation_target ON wiki_relation(target_id);

        -- Ingest 操作日志 (审计追踪)
        CREATE TABLE IF NOT EXISTS wiki_ingest_log (
            id                TEXT PRIMARY KEY,    -- UUID
            dun_id            TEXT,
            input_text        TEXT,                 -- 触发 ingest 的原始认知
            output_json       TEXT,                 -- LLM 输出的完整 JSON
            entities_affected TEXT,                 -- JSON array of entity IDs
            created_at        INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_wiki_ingest_dun ON wiki_ingest_log(dun_id);

        -- Wiki 向量索引 (语义搜索用, Entity 级粒度)
        CREATE TABLE IF NOT EXISTS wiki_vectors (
            entity_id   TEXT NOT NULL,
            chunk_seq   INTEGER NOT NULL DEFAULT 0,
            embedding   BLOB NOT NULL,
            chunk_content TEXT DEFAULT '',
            embedding_model TEXT DEFAULT '',
            embedding_fingerprint TEXT DEFAULT '',
            created_at  INTEGER NOT NULL,
            PRIMARY KEY (entity_id, chunk_seq)
        );
        CREATE INDEX IF NOT EXISTS idx_wv_entity ON wiki_vectors(entity_id);

        -- ============================================
        -- Study Room (自习室) 会话与段落
        -- 字段来源：server/handlers/study.py 中 INSERT/UPDATE/SELECT 反推
        --   - study_sessions: 写作会话元数据 (大对象 brief/document/chat_messages 等存 JSON 文件)
        --   - study_sections: 段落级状态 (乐观锁 revision)
        -- 风格指纹 (fingerprints) 和版本历史 (versions) 均用 JSON 文件存储，不入库
        -- ============================================
        CREATE TABLE IF NOT EXISTS study_sessions (
            id            TEXT PRIMARY KEY,
            title         TEXT NOT NULL DEFAULT '',
            genre         TEXT DEFAULT 'custom',
            length_hint   TEXT DEFAULT 'medium',
            dun_id        TEXT,
            status        TEXT NOT NULL DEFAULT 'active',   -- active | exported | archived
            revision      INTEGER NOT NULL DEFAULT 1,       -- 乐观锁
            exported_path TEXT,                             -- 导出归档路径 (status=exported 时填)
            created_at    INTEGER NOT NULL,
            updated_at    INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_study_sessions_status ON study_sessions(status);
        CREATE INDEX IF NOT EXISTS idx_study_sessions_updated ON study_sessions(updated_at);
        CREATE INDEX IF NOT EXISTS idx_study_sessions_dun ON study_sessions(dun_id);

        CREATE TABLE IF NOT EXISTS study_sections (
            id             TEXT NOT NULL,                   -- 段 id (前端从 agenda 生成)
            session_id     TEXT NOT NULL,
            section_order  INTEGER NOT NULL DEFAULT 0,
            status         TEXT NOT NULL DEFAULT 'planned', -- planned | drafting | done | skipped
            revision       INTEGER NOT NULL DEFAULT 1,      -- 段级乐观锁
            updated_at     INTEGER NOT NULL,
            PRIMARY KEY (id, session_id),
            FOREIGN KEY (session_id) REFERENCES study_sessions(id) ON DELETE CASCADE
        );
        CREATE INDEX IF NOT EXISTS idx_study_sections_session ON study_sections(session_id, section_order);
    """)

    # V6: 安全地添加 dun_id 列 (如果不存在) — memory 表
    try:
        conn.execute("SELECT dun_id FROM memory LIMIT 1")
    except sqlite3.OperationalError:
        conn.execute("ALTER TABLE memory ADD COLUMN dun_id TEXT")
        print("[SQLite] Added 'dun_id' column to memory table")

    # V6: 从旧 nexus_id 列迁移数据到 dun_id (如果 nexus_id 列存在)
    try:
        conn.execute("SELECT nexus_id FROM memory LIMIT 1")
        # nexus_id 列存在，把有值的数据拷贝到 dun_id
        migrated = conn.execute(
            "UPDATE memory SET dun_id = nexus_id WHERE nexus_id IS NOT NULL AND nexus_id != '' AND (dun_id IS NULL OR dun_id = '')"
        ).rowcount
        if migrated > 0:
            print(f"[SQLite] Migrated {migrated} rows: nexus_id → dun_id in memory table")
    except sqlite3.OperationalError:
        pass  # nexus_id 列不存在，跳过

    # V6: 安全地添加 dun_id 列 (如果不存在) — sessions 表
    try:
        conn.execute("SELECT dun_id FROM sessions LIMIT 1")
    except sqlite3.OperationalError:
        conn.execute("ALTER TABLE sessions ADD COLUMN dun_id TEXT")
        print("[SQLite] Added 'dun_id' column to sessions table")

    # 创建 dun_id 索引 (在确保列存在之后)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_memory_dun ON memory(dun_id)")

    # V3: 安全地添加 confidence 列 (如果不存在)
    try:
        conn.execute("SELECT confidence FROM memory LIMIT 1")
    except sqlite3.OperationalError:
        conn.execute("ALTER TABLE memory ADD COLUMN confidence REAL DEFAULT 0.5")
        print("[SQLite] Added 'confidence' column to memory table")

    # V5: 安全地添加 deleted_at 列 (软删除)
    try:
        conn.execute("SELECT deleted_at FROM memory LIMIT 1")
    except sqlite3.OperationalError:
        conn.execute("ALTER TABLE memory ADD COLUMN deleted_at INTEGER")
        print("[SQLite] Added 'deleted_at' column to memory table")

    # V5: 安全地添加 category 列
    try:
        conn.execute("SELECT category FROM memory LIMIT 1")
    except sqlite3.OperationalError:
        conn.execute("ALTER TABLE memory ADD COLUMN category TEXT DEFAULT 'uncategorized'")
        print("[SQLite] Added 'category' column to memory table")

    # V10: 为 memory 表安全地添加 supersede 四字段（幂等）
    # status: active | superseded | conflicted
    for col, definition in [
        ('status', "TEXT NOT NULL DEFAULT 'active'"),
        ('superseded_by', "TEXT"),
        ('supersede_reason', "TEXT"),
        ('supersede_at', "INTEGER"),
    ]:
        try:
            conn.execute(f"SELECT {col} FROM memory LIMIT 1")
        except sqlite3.OperationalError:
            # SQLite 不允许 ALTER TABLE ADD COLUMN 使用 NOT NULL 且无常量默认值之外的表达式
            # 'active' 是常量，OK
            conn.execute(f"ALTER TABLE memory ADD COLUMN {col} {definition}")
            print(f"[SQLite] Added '{col}' column to memory table (V10 supersede)")
    # 为 supersede 新字段建索引（幂等）
    conn.execute("CREATE INDEX IF NOT EXISTS idx_memory_status ON memory(status)")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_memory_superseded_by ON memory(superseded_by)")

    # V10: 为 wiki_claim 补齐 supersede_reason / supersede_at（与 memory 表对齐）
    for col, definition in [
        ('supersede_reason', "TEXT"),
        ('supersede_at', "INTEGER"),
    ]:
        try:
            conn.execute(f"SELECT {col} FROM wiki_claim LIMIT 1")
        except sqlite3.OperationalError:
            conn.execute(f"ALTER TABLE wiki_claim ADD COLUMN {col} {definition}")
            print(f"[SQLite] Added '{col}' column to wiki_claim table (V10 supersede)")

    # V9: Wiki Schema 迁移 — Entity 层新增字段
    for col, definition in [
        ('category', "TEXT"),
        ('temporal_scope', "TEXT"),
        ('consensus', "TEXT DEFAULT 'emerging'"),
        ('last_corroborated_at', "INTEGER"),
    ]:
        try:
            conn.execute(f"SELECT {col} FROM wiki_entity LIMIT 1")
        except sqlite3.OperationalError:
            conn.execute(f"ALTER TABLE wiki_entity ADD COLUMN {col} {definition}")
            print(f"[SQLite] Added '{col}' column to wiki_entity table")

    # V9: Wiki Schema 迁移 — Claim 层新增字段
    for col, definition in [
        ('observed_at', "TEXT"),
        ('source_summary', "TEXT"),
        ('corroboration', "INTEGER DEFAULT 1"),
        ('usage_count', "INTEGER DEFAULT 0"),
    ]:
        try:
            conn.execute(f"SELECT {col} FROM wiki_claim LIMIT 1")
        except sqlite3.OperationalError:
            conn.execute(f"ALTER TABLE wiki_claim ADD COLUMN {col} {definition}")
            print(f"[SQLite] Added '{col}' column to wiki_claim table")

    # V9: Entity Type 归并迁移 — 将非标准类型归入 concept
    try:
        migrated = conn.execute(
            "UPDATE wiki_entity SET type = 'concept' WHERE type IN ('fact', 'insight', 'metric', 'technology', 'economic-indicator', 'report', 'organization', 'case')"
        ).rowcount
        if migrated > 0:
            print(f"[SQLite] Migrated {migrated} wiki_entity type values to 'concept'")
    except Exception:
        pass

    for col, definition in [
        ('embedding_model', "TEXT DEFAULT ''"),
        ('embedding_fingerprint', "TEXT DEFAULT ''"),
    ]:
        try:
            conn.execute(f"SELECT {col} FROM wiki_vectors LIMIT 1")
        except sqlite3.OperationalError:
            conn.execute(f"ALTER TABLE wiki_vectors ADD COLUMN {col} {definition}")
            print(f"[SQLite] Added '{col}' column to wiki_vectors table")
    conn.execute("CREATE INDEX IF NOT EXISTS idx_wv_fingerprint ON wiki_vectors(embedding_fingerprint)")

    conn.commit()

    # V6: 向后兼容：迁移旧表 nexus_scoring 的数据到 dun_scoring
    try:
        cursor = conn.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='nexus_scoring'")
        if cursor.fetchone():
            # 检测 nexus_scoring 的列名（可能是 nexus_id 或 dun_id）
            ns_cols = [c[1] for c in conn.execute("PRAGMA table_info(nexus_scoring)").fetchall()]
            id_col = 'dun_id' if 'dun_id' in ns_cols else 'nexus_id'
            # 将 nexus_scoring 数据复制到 dun_scoring（跳过已存在的）
            migrated = conn.execute(f"""
                INSERT OR IGNORE INTO dun_scoring (dun_id, scoring_data, updated_at)
                SELECT {id_col}, scoring_data, updated_at FROM nexus_scoring
            """).rowcount
            if migrated:
                print(f"[SQLite] Migrated {migrated} rows from nexus_scoring → dun_scoring")
            conn.commit()
    except Exception as e:
        print(f"[SQLite] nexus_scoring migration note: {e}")

    # V6: dun_scoring 表列名迁移 nexus_id → dun_id
    try:
        conn.execute("SELECT dun_id FROM dun_scoring LIMIT 1")
    except sqlite3.OperationalError:
        try:
            conn.execute("SELECT nexus_id FROM dun_scoring LIMIT 1")
            # 旧列名存在，用 ALTER TABLE RENAME COLUMN (SQLite 3.25+)
            conn.execute("ALTER TABLE dun_scoring RENAME COLUMN nexus_id TO dun_id")
            print("[SQLite] Renamed column nexus_id → dun_id in dun_scoring table")
            conn.commit()
        except Exception:
            pass  # 表不存在或其他错误

    # V4: 创建向量存储表 (混合搜索)
    if HAS_HYBRID_SEARCH:
        ensure_vector_table(conn)

    print(f"[SQLite] Database initialized at {db_path}")

    # V9: Library 模块表 (知识库管线)
    from server.library.tracker import LIBRARY_TABLES_SQL
    conn.executescript(LIBRARY_TABLES_SQL)
    conn.commit()

    # V5: 启动容量合并定时任务 (daemon 线程)
    threading.Thread(
        target=_memory_capacity_merge_loop,
        args=(conn,),
        daemon=True,
    ).start()

    return conn

def _memory_capacity_merge_loop(conn: sqlite3.Connection) -> None:
    """后台定时检查各 category 容量，超限时合并或淘汰。

    策略：
    - preference / project (长期记忆): 超限时取最旧的 5 条合并为 1 条
    - discovery / uncategorized (短期记忆): 超限时软删除最旧的多余条目
    """
    print("[MemoryCapacity] Merge loop started (interval: 24h, initial check in 60s)")
    # 启动后延迟 60 秒再首次检查，等数据库完全就绪
    time.sleep(60)

    while True:
        try:
            _run_capacity_check(conn)
        except Exception as e:
            print(f"[MemoryCapacity] Error during capacity check: {e}")
        time.sleep(_CAPACITY_CHECK_INTERVAL)


def _run_capacity_check(conn: sqlite3.Connection) -> None:
    """单次容量检查和处理

    注意：exec_trace 记录被排除在容量管理之外，因为它们是知识编译的原材料。
    由知识编译管道在编译完成后负责清理。
    """
    now_ms = int(time.time() * 1000)

    for category, limit in _CATEGORY_CAPACITY_LIMITS.items():
        with _db_lock:
            # V10: 容量只基于 active 记忆统计，已 supersede 的不占额度
            row = conn.execute(
                "SELECT COUNT(*) as cnt FROM memory "
                "WHERE category = ? AND deleted_at IS NULL AND status = 'active' "
                "AND source != 'exec_trace'",
                (category,),
            ).fetchone()
        count = row['cnt'] if row else 0

        if count <= limit:
            continue

        excess = count - limit
        print(f"[MemoryCapacity] Category '{category}': {count}/{limit} (+{excess} over limit)")

        if category in ('preference', 'project'):
            # 合并策略：取最旧的 _MERGE_BATCH_SIZE 条 → 合并为 1 条
            _merge_oldest(conn, category, now_ms)
        else:
            # 淘汰策略：软删除最旧的多余条目
            _soft_delete_oldest(conn, category, excess, now_ms)


def _merge_oldest(conn: sqlite3.Connection, category: str, now_ms: int) -> None:
    """取最旧的 N 条同类记忆，合并内容为 1 条新记忆，软删除原始条目。

    V10: 引入保真检查（memory_compaction.check_preservation）：
      1. 先用 fallback_merge 做保守合并（去重 + 分号拼接）
      2. 用实体保留率 / 句数 fallback 检查合并质量
      3. 未通过 → 保留原条目不合并（等待下次，或由前端触发 LLM 合并路径）

    因为后端无 LLM 访问权限，真正的"语义重写"合并由前端驱动（可在后台任务中读取
    memory.status='active' 的原条目，调 LLM 生成新内容后走 /api/memory/supersede）。
    """
    with _db_lock:
        # V10: 只合并 active 条目，避免把 superseded 当原料
        rows = conn.execute(
            "SELECT id, content, tags, metadata, dun_id FROM memory "
            "WHERE category = ? AND deleted_at IS NULL AND status = 'active' "
            "ORDER BY created_at ASC LIMIT ?",
            (category, _MERGE_BATCH_SIZE),
        ).fetchall()

    if len(rows) < 2:
        return

    # 提取各条内容，去重
    contents: list[str] = []
    seen: set[str] = set()
    all_tags: set[str] = set()
    source_ids: list[str] = []

    for row in rows:
        text = row['content'].strip()
        # 简单去重：完全相同的内容跳过
        if text.lower() not in seen:
            contents.append(text)
            seen.add(text.lower())
        source_ids.append(row['id'])
        try:
            tags = json.loads(row['tags'] or '[]')
            if isinstance(tags, list):
                all_tags.update(tags)
        except (json.JSONDecodeError, TypeError):
            pass

    if not contents:
        return

    # V10: 用 compaction 模块做合并 + 保真检查
    max_chars = int(_COMPACTION_CONFIG.get('MAX_OUTPUT_CHARS', 500))
    if _HAS_COMPACTION:
        merged_content = fallback_merge(contents, max_chars=max_chars)

        # 读取 wiki_entity 标题做实体保留率检查
        entity_titles: list[str] = []
        try:
            with _db_lock:
                ent_rows = conn.execute(
                    "SELECT title FROM wiki_entity WHERE status = 'active' LIMIT 500"
                ).fetchall()
                entity_titles = [r['title'] for r in ent_rows if r['title']]
        except Exception:
            entity_titles = []

        passed, report = check_preservation(
            contents,
            merged_content,
            entity_titles=entity_titles or None,
            entity_retention_min=float(_COMPACTION_CONFIG.get('ENTITY_RETENTION_MIN', 0.8)),
            sentence_retention_min=float(_COMPACTION_CONFIG.get('SENTENCE_RETENTION_MIN', 0.6)),
        )
        if not passed:
            print(
                f"[MemoryCapacity] Preservation check FAILED for '{category}': "
                f"mode={report['mode']} retention={report['retention']} "
                f"threshold={report['threshold']}; skipping merge"
            )
            return
    else:
        # 极端 fallback：compaction 模块导入失败时，沿用旧逻辑
        merged_content = '；'.join(contents)
        if len(merged_content) > max_chars:
            merged_content = merged_content[:max_chars - 3] + '...'

    merged_id = f"mem-merged-{uuid.uuid4().hex[:12]}"
    merged_tags = json.dumps(list(all_tags | {'merged', f'merged_from_{len(source_ids)}'}))
    merged_metadata = json.dumps({
        'category': category,
        'merged_from': source_ids,
        'merged_at': now_ms,
        'compaction_mode': 'fallback_with_preservation_check',
    })

    with _db_lock:
        # 写入合并后的新条目（status 默认 active）
        conn.execute(
            "INSERT INTO memory (id, source, content, dun_id, tags, metadata, created_at, category, status) "
            "VALUES (?, 'memory', ?, NULL, ?, ?, ?, ?, 'active')",
            (merged_id, merged_content, merged_tags, merged_metadata, now_ms, category),
        )
        # V10: 将原始条目标记为 superseded（而非单纯 deleted）
        # 这样可以审计追溯哪些条目合并到了 merged_id
        placeholders = ','.join('?' * len(source_ids))
        conn.execute(
            f"""UPDATE memory
                SET status = 'superseded',
                    superseded_by = ?,
                    supersede_reason = ?,
                    supersede_at = ?,
                    deleted_at = ?
                WHERE id IN ({placeholders})""",
            [merged_id, f'capacity-merge into {category}', now_ms, now_ms] + source_ids,
        )
        conn.commit()

    print(f"[MemoryCapacity] Merged {len(source_ids)} '{category}' memories → {merged_id}")


def _soft_delete_oldest(conn: sqlite3.Connection, category: str, excess: int, now_ms: int) -> None:
    """软删除某类中最旧的 excess 条记忆（排除 exec_trace，它们由知识编译管道管理）"""
    with _db_lock:
        # V10: 只选 active 条目（不要把 superseded/conflicted 再软删一次）
        rows = conn.execute(
            "SELECT id FROM memory "
            "WHERE category = ? AND deleted_at IS NULL AND status = 'active' "
            "AND source != 'exec_trace' "
            "ORDER BY created_at ASC LIMIT ?",
            (category, excess),
        ).fetchall()

        if not rows:
            return

        ids = [r['id'] for r in rows]
        placeholders = ','.join('?' * len(ids))
        conn.execute(
            f"UPDATE memory SET deleted_at = ? WHERE id IN ({placeholders})",
            [now_ms] + ids,
        )
        conn.commit()

    print(f"[MemoryCapacity] Soft-deleted {len(ids)} oldest '{category}' memories")


# ============================================
# V10: 通用 Supersede 工具函数（供 memory / wiki_claim 复用）
# ============================================

# 白名单：允许执行 supersede 操作的表名，防 SQL 注入
_SUPERSEDE_ALLOWED_TABLES = frozenset({'memory', 'wiki_claim'})


def mark_superseded(
    conn: sqlite3.Connection,
    table: str,
    target_id: str,
    new_id: str | None,
    reason: str,
    ts: int,
) -> bool:
    """将指定记录标记为 superseded（被新记录取代）。

    Args:
        conn: 已连接的 sqlite3.Connection
        table: 目标表名，必须在白名单内
        target_id: 被取代的记录 id
        new_id: 新记录 id，可空（例如用户手动归档）
        reason: 取代原因（可读文本）
        ts: 取代时间戳（毫秒）

    Returns:
        是否成功更新（若记录不存在或已非 active，返回 False）

    Raises:
        ValueError: table 不在白名单
    """
    if table not in _SUPERSEDE_ALLOWED_TABLES:
        raise ValueError(f"mark_superseded: table {table!r} not allowed")

    with _db_lock:
        cursor = conn.execute(
            f"""UPDATE {table}
                SET status = 'superseded',
                    superseded_by = ?,
                    supersede_reason = ?,
                    supersede_at = ?
                WHERE id = ? AND status = 'active'""",
            (new_id, reason, ts, target_id),
        )
        conn.commit()
    return cursor.rowcount > 0


def mark_conflicted(
    conn: sqlite3.Connection,
    table: str,
    target_id: str,
    conflict_with: str,
    reason: str,
    ts: int,
) -> bool:
    """将两条记录标记为 conflicted（都不删，等后续信号解决）。

    对 wiki_claim：同时写 conflict_with 字段以保持向后兼容。
    对 memory：写入 superseded_by 字段（复用同一列指向冲突对方）。
    """
    if table not in _SUPERSEDE_ALLOWED_TABLES:
        raise ValueError(f"mark_conflicted: table {table!r} not allowed")

    with _db_lock:
        if table == 'wiki_claim':
            # wiki_claim 已有 conflict_with 列，同步写入保持兼容
            cursor = conn.execute(
                """UPDATE wiki_claim
                    SET status = 'conflicted',
                        conflict_with = ?,
                        supersede_reason = ?,
                        supersede_at = ?,
                        updated_at = ?
                    WHERE id = ? AND status = 'active'""",
                (conflict_with, reason, ts, ts, target_id),
            )
        else:
            cursor = conn.execute(
                f"""UPDATE {table}
                    SET status = 'conflicted',
                        superseded_by = ?,
                        supersede_reason = ?,
                        supersede_at = ?
                    WHERE id = ? AND status = 'active'""",
                (conflict_with, reason, ts, target_id),
            )
        conn.commit()
    return cursor.rowcount > 0


def _load_embedding_llm_config() -> dict:
    clawd_path = getattr(_embedding_manager, '_clawd_path', None)
    if not clawd_path:
        return {}
    config_file = Path(clawd_path) / 'data' / 'llm_config.json'
    if not config_file.exists():
        return {}
    try:
        data = json.loads(config_file.read_text(encoding='utf-8'))
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def shutdown_hybrid_engine():
    import server.state as _st
    if _st._embedding_engine and hasattr(_st._embedding_engine, 'shutdown'):
        try:
            _st._embedding_engine.shutdown()
        except Exception as e:
            print(f"[EmbeddingEngine] Failed to unload model: {e}")
    _st._embedding_engine = None
    _st._hybrid_engine = None


def _create_embedding_engine(config: dict):
    if _embedding_manager.should_use_local_for_config(config):
        model_dir = _embedding_manager._get_model_dir()
        if not model_dir.exists():
            return None
        return EmbeddingEngine(str(model_dir))

    base_url = str(config.get('embedBaseUrl') or '').strip()
    api_key = str(config.get('embedApiKey') or config.get('apiKey') or '').strip()
    model = str(config.get('embedModel') or '').strip()
    if not base_url or not api_key or not model:
        print('[EmbeddingEngine] External embedding config incomplete; hybrid vector search disabled')
        return None
    return OpenAICompatibleEmbeddingEngine(base_url=base_url, api_key=api_key, model=model)


def get_hybrid_engine():
    """获取混合搜索引擎 (懒初始化, 模型不存在时返回 None)"""
    import server.state as _st
    if not HAS_HYBRID_SEARCH:
        return None
    config = _load_embedding_llm_config()
    next_engine = _create_embedding_engine(config)
    if next_engine is None:
        shutdown_hybrid_engine()
        return None

    current_fp = getattr(_st._embedding_engine, 'fingerprint', None)
    next_fp = getattr(next_engine, 'fingerprint', None)
    if _st._hybrid_engine is not None and current_fp == next_fp:
        return _st._hybrid_engine

    shutdown_hybrid_engine()
    _st._embedding_engine = next_engine
    _st._hybrid_engine = HybridSearchEngine(
        embedding_engine=_st._embedding_engine,
        reranker_engine=None,
        llm_call_fn=None,
    )
    return _st._hybrid_engine


_vector_reindex_lock = threading.Lock()


def _count_vectors_for_engine(conn: sqlite3.Connection, table: str, id_col: str, embedding_engine) -> int:
    fp = getattr(embedding_engine, 'fingerprint', '')
    if getattr(embedding_engine, 'accepts_legacy_vectors', False):
        sql = (
            f"SELECT COUNT(DISTINCT {id_col}) FROM {table} "
            "WHERE embedding_fingerprint = ? OR embedding_fingerprint IS NULL OR embedding_fingerprint = ''"
        )
        return conn.execute(sql, (fp,)).fetchone()[0]
    return conn.execute(
        f"SELECT COUNT(DISTINCT {id_col}) FROM {table} WHERE embedding_fingerprint = ?",
        (fp,),
    ).fetchone()[0]


def ensure_current_vector_indexes(reason: str = 'manual'):
    import server.state as _st
    if not HAS_HYBRID_SEARCH or not _st._db_conn:
        return

    engine = get_hybrid_engine()
    embedding_engine = _st._embedding_engine
    if not engine or not embedding_engine:
        return
    if not embedding_engine.available:
        return

    conn = _st._db_conn
    fp = getattr(embedding_engine, 'fingerprint', 'unknown')
    try:
        with _db_lock:
            memory_total = conn.execute(
                "SELECT COUNT(*) FROM memory WHERE deleted_at IS NULL AND status = 'active' AND content != ''"
            ).fetchone()[0]
            memory_indexed = _count_vectors_for_engine(conn, 'memory_vectors', 'memory_id', embedding_engine)
            wiki_total = conn.execute(
                "SELECT COUNT(*) FROM wiki_entity WHERE status = 'active'"
            ).fetchone()[0]
            wiki_indexed = _count_vectors_for_engine(conn, 'wiki_vectors', 'entity_id', embedding_engine)

        if memory_total > 0 and memory_indexed < memory_total:
            print(f"[VectorIndex] Reindexing memory vectors ({reason}, {memory_indexed}/{memory_total}, fp={fp})")
            indexed = reindex_all_memory_vectors(conn, embedding_engine, _db_lock)
            print(f"[VectorIndex] Memory reindex complete: {indexed} memories")

        if wiki_total > 0 and wiki_indexed < wiki_total:
            print(f"[VectorIndex] Reindexing wiki vectors ({reason}, {wiki_indexed}/{wiki_total}, fp={fp})")
            indexed = reindex_all_wiki_vectors(conn, embedding_engine, _db_lock)
            print(f"[VectorIndex] Wiki reindex complete: {indexed} entities")
    except Exception as e:
        print(f"[VectorIndex] Reindex failed ({reason}): {e}")


def ensure_current_vector_indexes_async(reason: str = 'manual'):
    if not _vector_reindex_lock.acquire(blocking=False):
        return

    def _run():
        try:
            ensure_current_vector_indexes(reason)
        finally:
            _vector_reindex_lock.release()

    threading.Thread(target=_run, name='vector-reindex', daemon=True).start()
