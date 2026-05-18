"""DunCrew Server - Study Room (自习室) API Mixin

写作会话的 CRUD + 段状态更新 + 导出归档 + 风格指纹 (文风档案) 管理。
元数据存 SQLite (study_sessions / study_sections)，
大对象 (brief / evidence / agenda / document / chat_messages) 存 JSON 文件。
风格指纹 (fingerprints) 独立于 session, 存在 study_room/fingerprints/ 目录下。
"""
from __future__ import annotations

import json
import re
import shutil
import time
import urllib.request
import uuid
from pathlib import Path
from datetime import datetime

from server.state import _db_lock


def _now_ms() -> int:
    return int(time.time() * 1000)


def _uuid() -> str:
    return uuid.uuid4().hex[:16]


def _slugify(text: str, max_len: int = 40) -> str:
    """简易 slug: 取前 max_len 个非空白字符，替换空白为 -"""
    import re
    slug = re.sub(r'[^\w\u4e00-\u9fa5-]', '-', text.strip())
    slug = re.sub(r'-+', '-', slug).strip('-')
    return slug[:max_len] or 'untitled'


class StudyMixin:
    """Study Room API Mixin — 写作会话管理"""

    # --------------------------------------------------
    # Helpers
    # --------------------------------------------------

    def _study_dir(self, session_id: str) -> Path:
        """DunCrew-Data/study/{sessionId}/"""
        return self.clawd_path / 'study' / session_id

    def _read_study_json(self, session_id: str, filename: str):
        """读取 study/{sessionId}/{filename}.json，不存在返回 None"""
        fp = self._study_dir(session_id) / f'{filename}.json'
        if not fp.exists():
            return None
        try:
            return json.loads(fp.read_text(encoding='utf-8'))
        except Exception:
            return None

    def _write_study_json(self, session_id: str, filename: str, data) -> bool:
        """写入 study/{sessionId}/{filename}.json"""
        d = self._study_dir(session_id)
        d.mkdir(parents=True, exist_ok=True)
        fp = d / f'{filename}.json'
        try:
            fp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')
            return True
        except Exception:
            return False

    # --------------------------------------------------
    # POST /api/study/sessions — 创建会话
    # --------------------------------------------------

    def handle_study_session_create(self, data: dict):
        sid = _uuid()
        now = _now_ms()
        title = data.get('title', '')
        genre = data.get('genre', 'custom')
        length_hint = data.get('length_hint', 'medium')
        dun_id = data.get('dun_id')

        db = self._get_db()
        with _db_lock:
            db.execute(
                """INSERT INTO study_sessions (id, title, genre, length_hint, dun_id, status, revision, created_at, updated_at)
                   VALUES (?, ?, ?, ?, ?, 'active', 1, ?, ?)""",
                (sid, title, genre, length_hint, dun_id, now, now),
            )
            db.commit()

        # 创建 study/{sessionId}/ 目录
        self._study_dir(sid).mkdir(parents=True, exist_ok=True)

        # 如果传了 brief，写入文件
        brief = data.get('brief')
        if brief:
            self._write_study_json(sid, 'brief', brief)

        self.send_json({'id': sid, 'created_at': now, 'revision': 1}, 201)

    # --------------------------------------------------
    # GET /api/study/sessions — 列表
    # --------------------------------------------------

    def handle_study_sessions_list(self, query: dict):
        db = self._get_db()
        status = query.get('status', [None])[0]
        genre = query.get('genre', [None])[0]
        try:
            limit = int(query.get('limit', ['50'])[0])
            offset = int(query.get('offset', ['0'])[0])
        except (ValueError, TypeError):
            limit, offset = 50, 0

        where = []
        params: list = []
        if status:
            where.append('status = ?')
            params.append(status)
        if genre:
            where.append('genre = ?')
            params.append(genre)

        where_sql = ('WHERE ' + ' AND '.join(where)) if where else ''
        sql = f'SELECT * FROM study_sessions {where_sql} ORDER BY updated_at DESC LIMIT ? OFFSET ?'
        params.extend([limit, offset])

        with _db_lock:
            rows = db.execute(sql, params).fetchall()

        sessions = [dict(r) for r in rows]
        self.send_json({'sessions': sessions, 'total': len(sessions)})

    # --------------------------------------------------
    # GET /api/study/sessions/:id — 读取详情
    # --------------------------------------------------

    def handle_study_session_get(self, session_id: str):
        db = self._get_db()
        with _db_lock:
            row = db.execute('SELECT * FROM study_sessions WHERE id = ?', (session_id,)).fetchone()
        if not row:
            self.send_error_json('Session not found', 404)
            return

        result = dict(row)
        # 加载大对象 JSON
        result['brief'] = self._read_study_json(session_id, 'brief')
        result['evidence'] = self._read_study_json(session_id, 'evidence')
        result['agenda'] = self._read_study_json(session_id, 'agenda')
        # v2 新增: 文章全文 + 对话消息 (对话驱动写作流的核心产出)
        doc_payload = self._read_study_json(session_id, 'document')
        result['document'] = doc_payload.get('content', '') if isinstance(doc_payload, dict) else (doc_payload or '')
        chat_payload = self._read_study_json(session_id, 'chat_messages')
        result['chat_messages'] = chat_payload if isinstance(chat_payload, list) else []
        # 风格档案 / 长期记忆快照 (可选)
        result['memory_snippets'] = self._read_study_json(session_id, 'memory_snippets') or []

        # 加载 sections 元数据
        with _db_lock:
            sec_rows = db.execute(
                'SELECT * FROM study_sections WHERE session_id = ? ORDER BY section_order',
                (session_id,),
            ).fetchall()
        result['sections'] = [dict(r) for r in sec_rows]

        self.send_json(result)

    # --------------------------------------------------
    # PATCH /api/study/sessions/:id — 更新元数据 (乐观锁)
    # --------------------------------------------------

    def handle_study_session_update(self, session_id: str, data: dict):
        db = self._get_db()
        expected_rev = data.get('revision')
        now = _now_ms()

        # 乐观锁检查
        with _db_lock:
            row = db.execute('SELECT revision FROM study_sessions WHERE id = ?', (session_id,)).fetchone()
        if not row:
            self.send_error_json('Session not found', 404)
            return
        if expected_rev is not None and row['revision'] != expected_rev:
            self.send_error_json('Conflict: revision mismatch', 409)
            return

        # 可更新字段
        updatable = ['title', 'genre', 'length_hint', 'status', 'dun_id', 'exported_path']
        sets = ['updated_at = ?', 'revision = revision + 1']
        params: list = [now]
        for field in updatable:
            if field in data:
                sets.append(f'{field} = ?')
                params.append(data[field])
        params.append(session_id)

        with _db_lock:
            db.execute(f"UPDATE study_sessions SET {', '.join(sets)} WHERE id = ?", params)
            new_rev = db.execute('SELECT revision FROM study_sessions WHERE id = ?', (session_id,)).fetchone()['revision']
            db.commit()

        # 更新大对象 JSON (如果提供)
        for key in ('brief', 'evidence', 'agenda'):
            if key in data:
                self._write_study_json(session_id, key, data[key])

        # v2: 对话驱动写作的关键产出 —— 文章全文 + 聊天消息 + 记忆快照
        # document 用 {content: "..."} 包一层, 方便后续加元数据 (如 wordCount)
        if 'document' in data:
            doc = data['document'] or ''
            self._write_study_json(session_id, 'document', {
                'content': doc,
                'word_count': len((doc or '').replace(' ', '').replace('\n', '').replace('\t', '')),
                'updated_at': now,
            })
        if 'chat_messages' in data and isinstance(data['chat_messages'], list):
            self._write_study_json(session_id, 'chat_messages', data['chat_messages'])
        if 'memory_snippets' in data and isinstance(data['memory_snippets'], list):
            self._write_study_json(session_id, 'memory_snippets', data['memory_snippets'])

        self.send_json({'id': session_id, 'revision': new_rev, 'updated_at': now})

    # --------------------------------------------------
    # DELETE /api/study/sessions/:id — 删除
    # --------------------------------------------------

    def handle_study_session_delete(self, session_id: str):
        db = self._get_db()
        with _db_lock:
            row = db.execute('SELECT id FROM study_sessions WHERE id = ?', (session_id,)).fetchone()
        if not row:
            self.send_error_json('Session not found', 404)
            return

        with _db_lock:
            db.execute('DELETE FROM study_sessions WHERE id = ?', (session_id,))
            db.commit()

        # 删除文件目录
        study_dir = self._study_dir(session_id)
        if study_dir.exists():
            shutil.rmtree(study_dir, ignore_errors=True)

        self.send_json({'deleted': session_id})

    # --------------------------------------------------
    # 版本历史 (document versions)
    #   - 存储路径: study/{sid}/versions.json
    #   - 数据结构: {"versions": [DocumentVersion, ...]}
    #   - 每个 DocumentVersion 存整篇全文快照 + 元信息
    #     (按用户约定: 不限制数量, 全部保留)
    # --------------------------------------------------

    def _read_versions(self, session_id: str) -> list:
        data = self._read_study_json(session_id, 'versions')
        if isinstance(data, dict) and isinstance(data.get('versions'), list):
            return data['versions']
        if isinstance(data, list):
            return data
        return []

    def _write_versions(self, session_id: str, versions: list) -> bool:
        return self._write_study_json(session_id, 'versions', {
            'versions': versions,
            'updated_at': _now_ms(),
        })

    # ----- GET /api/study/sessions/:id/versions -----
    def handle_study_versions_list(self, session_id: str):
        """
        返回所有历史版本, 按 createdAt 倒序 (最新在前).
        为避免返回体过大, 列表接口默认不返回 document 全文,
        由前端在用户点击具体版本后再按 id 单独拉取.
        """
        db = self._get_db()
        with _db_lock:
            row = db.execute(
                'SELECT id FROM study_sessions WHERE id = ?', (session_id,),
            ).fetchone()
        if not row:
            self.send_error_json('Session not found', 404)
            return

        versions = self._read_versions(session_id)
        versions_sorted = sorted(versions, key=lambda v: v.get('createdAt', 0), reverse=True)

        # 轻量化返回 (不带 document 全文), 节省带宽
        light = [
            {
                'id': v.get('id'),
                'createdAt': v.get('createdAt'),
                'wordCount': v.get('wordCount'),
                'trigger': v.get('trigger'),
                'summary': v.get('summary'),
                'parentVersionId': v.get('parentVersionId'),
            }
            for v in versions_sorted
        ]
        self.send_json({'versions': light, 'total': len(light)})

    # ----- POST /api/study/sessions/:id/versions — 追加一个版本 -----
    def handle_study_versions_append(self, session_id: str, data: dict):
        """
        请求体: DocumentVersion 对象
          {
            id, document, wordCount, createdAt, trigger, summary?, parentVersionId?
          }
        仅做基本字段校验 + 追加, 不做 dedup / 数量上限 (用户明确要求全部保留).
        返回: {id, total}
        """
        db = self._get_db()
        with _db_lock:
            row = db.execute(
                'SELECT id FROM study_sessions WHERE id = ?', (session_id,),
            ).fetchone()
        if not row:
            self.send_error_json('Session not found', 404)
            return

        if not isinstance(data, dict):
            self.send_error_json('Invalid payload', 400)
            return
        document = data.get('document')
        if not isinstance(document, str):
            self.send_error_json('Missing or invalid document field', 400)
            return

        now = _now_ms()
        version = {
            'id': str(data.get('id') or f'v-{_uuid()}'),
            'document': document,
            'wordCount': int(data.get('wordCount') or len(document.replace(' ', '').replace('\n', '').replace('\t', ''))),
            'createdAt': int(data.get('createdAt') or now),
            'trigger': str(data.get('trigger') or 'unknown'),
            'summary': data.get('summary') if isinstance(data.get('summary'), (dict, str)) else None,
            'parentVersionId': data.get('parentVersionId') if isinstance(data.get('parentVersionId'), str) else None,
        }

        versions = self._read_versions(session_id)
        versions.append(version)
        self._write_versions(session_id, versions)

        # 返回时带完整版本 (包含 document) 供前端直接更新本地缓存
        self.send_json({
            'id': version['id'],
            'version': version,
            'total': len(versions),
        }, 201)

    # ----- GET /api/study/sessions/:id/versions/:vid — 单个版本详情 (含全文) -----
    def handle_study_version_get(self, session_id: str, version_id: str):
        versions = self._read_versions(session_id)
        target = next((v for v in versions if v.get('id') == version_id), None)
        if not target:
            self.send_error_json('Version not found', 404)
            return
        self.send_json(target)

    # --------------------------------------------------
    # POST /api/study/sessions/:id/sections/:sid — 段状态更新 (乐观锁)
    # --------------------------------------------------

    def handle_study_section_update(self, session_id: str, section_id: str, data: dict):
        db = self._get_db()
        now = _now_ms()
        expected_rev = data.get('revision')
        new_status = data.get('status')

        with _db_lock:
            row = db.execute(
                'SELECT revision, status FROM study_sections WHERE id = ? AND session_id = ?',
                (section_id, session_id),
            ).fetchone()

        if not row:
            # 段不存在则创建 (首次从 agenda 同步)
            order = data.get('section_order', 0)
            with _db_lock:
                db.execute(
                    """INSERT INTO study_sections (id, session_id, section_order, status, revision, updated_at)
                       VALUES (?, ?, ?, ?, 1, ?)""",
                    (section_id, session_id, order, new_status or 'planned', now),
                )
                db.commit()
            self.send_json({'id': section_id, 'revision': 1, 'updated_at': now}, 201)
            return

        if expected_rev is not None and row['revision'] != expected_rev:
            self.send_error_json('Conflict: section revision mismatch', 409)
            return

        sets = ['updated_at = ?', 'revision = revision + 1']
        params: list = [now]
        if new_status:
            sets.append('status = ?')
            params.append(new_status)
        if 'section_order' in data:
            sets.append('section_order = ?')
            params.append(data['section_order'])
        params.extend([section_id, session_id])

        with _db_lock:
            db.execute(
                f"UPDATE study_sections SET {', '.join(sets)} WHERE id = ? AND session_id = ?",
                params,
            )
            new_rev = db.execute('SELECT revision FROM study_sections WHERE id = ?', (section_id,)).fetchone()['revision']
            db.commit()

        self.send_json({'id': section_id, 'revision': new_rev, 'updated_at': now})

    # --------------------------------------------------
    # POST /api/study/sessions/:id/export — 导出归档
    # --------------------------------------------------

    def handle_study_session_export(self, session_id: str, data: dict):
        db = self._get_db()
        with _db_lock:
            row = db.execute('SELECT * FROM study_sessions WHERE id = ?', (session_id,)).fetchone()
        if not row:
            self.send_error_json('Session not found', 404)
            return

        session = dict(row)
        brief = self._read_study_json(session_id, 'brief')
        evidence = self._read_study_json(session_id, 'evidence')
        agenda = self._read_study_json(session_id, 'agenda')

        # v2: 优先读 document (对话驱动写作的全文产出)
        doc_payload = self._read_study_json(session_id, 'document')
        document_text = ''
        if isinstance(doc_payload, dict):
            document_text = doc_payload.get('content', '')
        elif isinstance(doc_payload, str):
            document_text = doc_payload

        if not document_text and not agenda:
            self.send_error_json('No content to export', 400)
            return

        # 构建归档目录
        title = session.get('title') or (brief or {}).get('intent', 'untitled')
        slug = _slugify(title)
        date_str = datetime.now().strftime('%Y-%m-%d')
        archive_name = f'{date_str}-{slug}'
        archive_dir: Path = self.clawd_path / 'documents' / archive_name
        archive_dir.mkdir(parents=True, exist_ok=True)

        # v2: 如果有 document 全文, 直接使用; 否则降级到 v1 的 agenda.sections 拼接
        if document_text.strip():
            markdown_content = document_text
        else:
            # v1 降级: 从 agenda sections 拼接
            md_parts = []
            doc_title = (agenda or {}).get('title', title)
            md_parts.append(f'# {doc_title}\n')
            if agenda and agenda.get('subtitle'):
                md_parts.append(f'> {agenda["subtitle"]}\n')
            if agenda and agenda.get('openingStance'):
                md_parts.append(f'{agenda["openingStance"]}\n')

            sections = (agenda or {}).get('sections', [])
            all_footnotes = []
            for sec in sections:
                heading = sec.get('heading', '')
                draft = sec.get('draft', '')
                md_parts.append(f'## {heading}\n')
                if draft:
                    md_parts.append(f'{draft}\n')
                for fn in sec.get('footnotes', []):
                    all_footnotes.append(fn)

            if agenda and agenda.get('closingCall'):
                md_parts.append(f'---\n\n{agenda["closingCall"]}\n')

            if all_footnotes:
                md_parts.append('\n---\n\n### 参考文献\n')
                for fn in all_footnotes:
                    md_parts.append(f'- [{fn.get("label", "")}] {fn.get("marker", "")}\n')

            markdown_content = '\n'.join(md_parts)

        doc_title = title
        if agenda and agenda.get('title'):
            doc_title = agenda['title']

        # 写入文件
        (archive_dir / 'document.md').write_text(markdown_content, encoding='utf-8')
        if evidence:
            (archive_dir / 'evidence.json').write_text(
                json.dumps(evidence, ensure_ascii=False, indent=2), encoding='utf-8'
            )
        if agenda:
            (archive_dir / 'agenda.json').write_text(
                json.dumps(agenda, ensure_ascii=False, indent=2), encoding='utf-8'
            )

        # 写 session.meta.json
        sections = (agenda or {}).get('sections', [])
        meta = {
            'sessionId': session_id,
            'title': doc_title,
            'genre': session.get('genre'),
            'createdAt': session.get('created_at'),
            'exportedAt': _now_ms(),
            'revision': session.get('revision'),
            'sections': len(sections),
        }
        (archive_dir / 'session.meta.json').write_text(
            json.dumps(meta, ensure_ascii=False, indent=2), encoding='utf-8'
        )

        # 更新 SQLite
        exported_path = str(archive_dir)
        with _db_lock:
            db.execute(
                "UPDATE study_sessions SET status = 'exported', exported_path = ?, updated_at = ?, revision = revision + 1 WHERE id = ?",
                (exported_path, _now_ms(), session_id),
            )
            db.commit()

        self.send_json({
            'success': True,
            'archivePath': exported_path,
            'archiveName': archive_name,
        })

    # ==========================================================
    # 风格指纹 (Writer Fingerprint) — 用户级全局资源
    # 存储路径: DunCrew-Data/study_room/fingerprints/
    #   - index.json : WriterFingerprintMeta[] 列表
    #   - {id}.json  : 单个指纹完整详情
    # ==========================================================

    def _fp_root(self) -> Path:
        d = self.clawd_path / 'study_room' / 'fingerprints'
        d.mkdir(parents=True, exist_ok=True)
        return d

    def _fp_index_path(self) -> Path:
        return self._fp_root() / 'index.json'

    def _fp_detail_path(self, fp_id: str) -> Path:
        # 防路径穿越
        safe = re.sub(r'[^a-zA-Z0-9_-]', '', fp_id)
        return self._fp_root() / f'{safe}.json'

    def _fp_read_index(self) -> list:
        p = self._fp_index_path()
        if not p.exists():
            return []
        try:
            return json.loads(p.read_text(encoding='utf-8'))
        except Exception:
            return []

    def _fp_write_index(self, metas: list) -> None:
        p = self._fp_index_path()
        p.write_text(json.dumps(metas, ensure_ascii=False, indent=2), encoding='utf-8')

    def _fp_meta_from_detail(self, fp: dict) -> dict:
        """从完整 fingerprint 对象提取元信息 (index 用)"""
        return {
            'id': fp.get('id'),
            'name': fp.get('name'),
            'description': fp.get('description'),
            'sourceCount': fp.get('sourceCount'),
            'sourceWordCount': fp.get('sourceWordCount'),
            'createdAt': fp.get('createdAt'),
            'updatedAt': fp.get('updatedAt'),
        }

    # ----- GET /api/study/fingerprints -----
    def handle_fingerprint_list(self):
        metas = self._fp_read_index()
        # 按 updatedAt 倒序
        metas.sort(key=lambda m: m.get('updatedAt', 0), reverse=True)
        self.send_json({'fingerprints': metas, 'total': len(metas)})

    # ----- GET /api/study/fingerprints/:id -----
    def handle_fingerprint_get(self, fp_id: str):
        p = self._fp_detail_path(fp_id)
        if not p.exists():
            self.send_error_json('Fingerprint not found', 404)
            return
        try:
            data = json.loads(p.read_text(encoding='utf-8'))
            self.send_json(data)
        except Exception as e:
            self.send_error_json(f'Failed to read fingerprint: {e}', 500)

    # ----- PUT /api/study/fingerprints/:id — 创建或更新 -----
    def handle_fingerprint_put(self, fp_id: str, data: dict):
        if not isinstance(data, dict):
            self.send_error_json('Invalid payload', 400)
            return
        data = dict(data)  # shallow copy
        data['id'] = fp_id
        now = _now_ms()
        if not data.get('createdAt'):
            data['createdAt'] = now
        data['updatedAt'] = now
        # 字段兜底
        data.setdefault('name', '未命名风格')
        data.setdefault('metrics', {})
        data.setdefault('profile', {})
        data.setdefault('samples', [])

        p = self._fp_detail_path(fp_id)
        p.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding='utf-8')

        # 更新 index
        metas = self._fp_read_index()
        meta = self._fp_meta_from_detail(data)
        idx_pos = next((i for i, m in enumerate(metas) if m.get('id') == fp_id), -1)
        if idx_pos >= 0:
            metas[idx_pos] = meta
        else:
            metas.insert(0, meta)
        self._fp_write_index(metas)

        self.send_json(data)

    # ----- DELETE /api/study/fingerprints/:id -----
    def handle_fingerprint_delete(self, fp_id: str):
        p = self._fp_detail_path(fp_id)
        if p.exists():
            try:
                p.unlink()
            except Exception:
                pass
        metas = [m for m in self._fp_read_index() if m.get('id') != fp_id]
        self._fp_write_index(metas)
        self.send_json({'deleted': fp_id})

    # ----- POST /api/study/fingerprints/distill-prepare -----
    # 前端发起提炼时先调此接口, 后端读文件 + 算指标 + 选范文, 不碰 LLM.
    # 前端拿到返回后, 用用户在设置中配置的 LLM (走 /api/llm/proxy) 生成 Layer 2 画像,
    # 最后通过 PUT /api/study/fingerprints/:id 落盘.
    # 这样后端不需要管 LLM key/model, 完全复用用户已有的前端 LLM 配置.
    def handle_fingerprint_distill_prepare(self, data: dict):
        """
        请求体:
          {
            "sources": [{"path": "documents/xxx.md"} | {"text": "...", "title": "..."}]
          }

        返回:
          {
            "combinedText": "...",  # 拼接后的正文 (前 30000 字截断)
            "metrics": {...},        # Layer 1 结构化指标
            "samples": [...],        # Layer 3 范文候选
            "sourceCount": N,
            "sourceWordCount": N,
            "sourcePaths": [...]
          }
        """
        sources = data.get('sources') or []
        if not sources:
            self.send_error_json('Missing sources', 400)
            return

        # 1. 读取全部源文档 (允许失败, 过滤掉)
        documents = []  # [{title, text, path}]
        for src in sources:
            if not isinstance(src, dict):
                continue
            text = src.get('text')
            title = src.get('title') or ''
            path = src.get('path')
            if not text and path:
                # 路径相对于 clawd_path 或绝对路径. 做路径穿越保护.
                p = Path(path)
                if not p.is_absolute():
                    p = (self.clawd_path / p).resolve()
                else:
                    p = p.resolve()
                try:
                    # 必须在 clawd_path 内, 防止读任意文件
                    p.relative_to(self.clawd_path.resolve())
                except ValueError:
                    continue  # 越界, 跳过
                if p.exists() and p.is_file():
                    try:
                        raw = p.read_text(encoding='utf-8', errors='ignore')
                        text = _strip_markdown_meta(raw)
                        if not title:
                            title = p.stem
                    except Exception:
                        text = None
            if text and text.strip():
                documents.append({
                    'title': title or 'untitled',
                    'text': text,
                    'path': path,
                })

        if not documents:
            self.send_error_json('No readable source documents', 400)
            return

        # 2. 算 Layer 1 结构化指标 (全部文本合并统计)
        combined_text = '\n\n'.join(d['text'] for d in documents)
        metrics = _compute_style_metrics(combined_text)

        # 3. 选 Layer 3 范文片段
        samples = _select_samples(documents, max_samples=3)

        # 4. 源字数统计
        source_wc = sum(
            len(d['text'].replace(' ', '').replace('\n', '').replace('\t', ''))
            for d in documents
        )

        # 5. 返回给前端 (前端负责调 LLM 生成 profile, 然后 PUT 落盘)
        # combinedText 截断到 30000 字, 避免把超大文本丢给 LLM
        self.send_json({
            'combinedText': combined_text[:30000],
            'metrics': metrics,
            'samples': samples,
            'sourceCount': len(documents),
            'sourceWordCount': source_wc,
            'sourcePaths': [d.get('path') for d in documents if d.get('path')],
        })

    # ----- GET /api/study/documents — 列出可用于提炼的文档 -----
    def handle_study_documents_list(self, query: dict):
        """
        扫描 DunCrew-Data/documents/ 下的 .md 文件, 提供给 DistillDialog 文档选择器用.
        也包括 nexuses/*/output/*.md.

        Query:
          - limit: 默认 100
          - search: 按文件名关键词过滤
        """
        try:
            limit = int(query.get('limit', ['100'])[0])
        except (ValueError, TypeError):
            limit = 100
        search = (query.get('search', [''])[0] or '').lower().strip()

        results = []
        base = self.clawd_path

        # 扫描候选目录
        scan_dirs = [
            base / 'documents',
            base / 'nexuses',
            base / 'study' / '_exports',  # 自习室导出产物
        ]

        for d in scan_dirs:
            if not d.exists() or not d.is_dir():
                continue
            # 限制递归深度避免扫爆
            try:
                for p in d.rglob('*.md'):
                    if not p.is_file():
                        continue
                    try:
                        # 相对路径
                        rel = p.relative_to(base).as_posix()
                    except Exception:
                        continue
                    if search and search not in rel.lower():
                        continue
                    try:
                        stat = p.stat()
                        size = stat.st_size
                        # 跳过过小的文件 (< 200 字节, 基本没内容)
                        if size < 200:
                            continue
                        results.append({
                            'path': rel,
                            'name': p.name,
                            'size': size,
                            'updatedAt': int(stat.st_mtime * 1000),
                        })
                    except Exception:
                        continue
            except Exception:
                continue

        # 按 updatedAt 倒序
        results.sort(key=lambda r: r.get('updatedAt', 0), reverse=True)
        results = results[:limit]
        self.send_json({'documents': results, 'total': len(results)})


# ==========================================================
# 辅助函数 — 风格提炼
# ==========================================================

def _strip_markdown_meta(text: str) -> str:
    """去掉 YAML frontmatter + 代码块 (避免噪声干扰风格分析)"""
    # frontmatter
    if text.startswith('---'):
        end = text.find('\n---', 3)
        if end > 0:
            text = text[end + 4:]
    # 代码块
    text = re.sub(r'```[\s\S]*?```', '', text)
    return text.strip()


def _compute_style_metrics(text: str) -> dict:
    """Layer 1: 纯 Python 计算结构化指标 (不依赖 jieba)"""
    if not text:
        return {}

    # 段落
    paragraphs = [p.strip() for p in re.split(r'\n\s*\n', text) if p.strip()]
    total_para = max(1, len(paragraphs))

    # 句子 (中英文标点切分)
    sentences = re.split(r'[。！？!?.;；\n]', text)
    sentences = [s.strip() for s in sentences if s.strip()]
    total_sent = max(1, len(sentences))
    sent_lens = [len(s) for s in sentences]

    # 平均 & 标准差
    avg_sent_len = sum(sent_lens) / total_sent
    variance = sum((x - avg_sent_len) ** 2 for x in sent_lens) / total_sent
    std_sent_len = variance ** 0.5

    para_lens = [len(p) for p in paragraphs]
    avg_para_len = sum(para_lens) / total_para

    # 字数 (去空白)
    pure_len = len(re.sub(r'\s', '', text))

    # 特征计数 (轻量正则, 不依赖词库)
    # 成语: 4字固定搭配很难精确, 改用常见模式 "X然/X而已/一X而X" 等 — 实际用简化启发
    idiom_hits = len(re.findall(r'[\u4e00-\u9fff]{4}(?=[，。、；！？\s])', text))
    # 第一人称
    fp_hits = len(re.findall(r'我[们]?(?:的|们)?', text))
    # 被动
    passive_hits = len(re.findall(r'被(?:[\u4e00-\u9fff]){1,3}', text))
    # 反问设问
    rhet_hits = text.count('？') + text.count('?')
    # 语气词
    modal_hits = len(re.findall(r'[吧呢啊嘛呀哦罢矣哉耳焉也]', text))
    # 排比: 三个及以上逗号连续的短语 (启发式)
    parallel_hits = len(re.findall(r'(?:[\u4e00-\u9fff]{2,10}[，,]){2,}[\u4e00-\u9fff]{2,10}', text))
    # 长短句
    short_sent = sum(1 for x in sent_lens if x <= 10)
    long_sent = sum(1 for x in sent_lens if x > 30)

    # 书面/口语倾向: 书面词频 - 口语词频 归一化
    written_hits = len(re.findall(r'(?:然而|因此|此外|综上|鉴于|虽然|尽管|固然|盖|遂|兹|谨|敬|应当|必须)', text))
    spoken_hits = len(re.findall(r'(?:啊|呀|呗|嘛|咯|哈|嘿|吼|真的|挺|特别|超|真是|其实|就是|哎)', text))
    formality = 0
    denom = max(1, written_hits + spoken_hits)
    formality = (written_hits - spoken_hits) / denom
    formality = max(-1.0, min(1.0, formality))

    # ---- Layer 1 扩展指标 (支撑 Layer 2 的话语/态度/结构维度) ----

    # 1) 关联词密度: 转折/递进/因果连接词 → 支撑 transitionStyle
    conj_hits = len(re.findall(
        r'(?:然而|反之|况且|反观|不过|因此|此外|然则|因而|故而|于是|从而|所以|也就是说|换句话说|与此同时|更重要的是|值得注意的是)',
        text,
    ))

    # 2) 模态词密度: 强断言词 + 弱推测词混合统计 → 支撑 certaintyLevel
    modal_hits_strong = len(re.findall(r'(?:必然|必定|一定|肯定|绝对|显然|毋庸置疑|毫无疑问)', text))
    modal_hits_weak = len(re.findall(r'(?:或许|可能|似乎|大概|也许|兴许|大抵|估计|恐怕|想必|兴许|多半)', text))
    modal_word_hits = modal_hits_strong + modal_hits_weak

    # 3) 问句密度 (中英文问号) → 支撑 informationDensity / hookPattern
    question_hits = text.count('？') + text.count('?')

    # 4) 反问句占比: 反问启发式特征词命中 / 总问句数 ∈ [0, 1]
    rhetorical_q_hits = len(re.findall(r'(?:难道|岂|何必|怎能|何至|何尝|焉|岂不|岂能|莫非)', text))
    # 反问特征词往往伴随问号出现, 取与问句数的比例 (上限 1.0)
    if question_hits > 0:
        rhetorical_q_rate = min(1.0, rhetorical_q_hits / question_hits)
    else:
        rhetorical_q_rate = 0.0

    # 5) 段首断言密度: 段落首句以判断性词语开头的占比 → 支撑 informationDensity
    #    判断性起手词: "是/即/乃/本质上/归根结底/毫无疑问/事实是/真相是/结论很简单"
    assertion_first_pattern = re.compile(
        r'^(?:就是|是|即|乃|本质上|归根结底|毫无疑问|事实是|真相是|结论很简单|答案是|道理很简单|关键在于|核心是)'
    )
    assertion_first_hits = sum(1 for p in paragraphs if assertion_first_pattern.match(p))
    assertion_density = round(assertion_first_hits / total_para, 3)

    # 6) 读者称呼分布 → 支撑 readerDistance
    #    你 (排除 "你们/你的" 以避免误判第二人称复数为单数亲昵)
    address_you_hits = len(re.findall(r'你(?![们的])', text))
    # 您 (书面/尊敬)
    address_you_formal_hits = len(re.findall(r'您', text))
    # 我们 / 咱们 (共同体视角)
    address_we_hits = len(re.findall(r'(?:我们|咱们)', text))
    # 大家 / 诸位 / 各位 / 列位 (面向群体)
    address_everyone_hits = len(re.findall(r'(?:大家|诸位|各位|列位)', text))

    def per_k(hits: int) -> float:
        return round(hits * 1000 / max(1, pure_len), 3)

    return {
        'avgSentenceLen': round(avg_sent_len, 2),
        'sentenceLenStd': round(std_sent_len, 2),
        'avgParagraphLen': round(avg_para_len, 2),
        'idiomDensity': per_k(idiom_hits),
        'firstPersonRate': per_k(fp_hits),
        'passiveRate': per_k(passive_hits),
        'rhetoricRate': per_k(rhet_hits),
        'modalParticleDensity': per_k(modal_hits),
        'parallelismRate': per_k(parallel_hits),
        'shortSentenceRate': round(short_sent / total_sent, 3),
        'longSentenceRate': round(long_sent / total_sent, 3),
        'formalityScore': round(formality, 3),
        'citationRate': per_k(text.count('[^')),
        # ---- 扩展指标 (支撑 Layer 2 的话语/态度/结构维度) ----
        'conjunctionDensity': per_k(conj_hits),
        'modalDensity': per_k(modal_word_hits),
        'questionDensity': per_k(question_hits),
        'rhetoricalQuestionRate': round(rhetorical_q_rate, 3),
        'assertionDensity': assertion_density,
        'addressYou': per_k(address_you_hits),
        'addressYouFormal': per_k(address_you_formal_hits),
        'addressWe': per_k(address_we_hits),
        'addressEveryone': per_k(address_everyone_hits),
    }


def _llm_distill_profile(text: str, metrics: dict, name: str) -> dict:
    """Layer 2: 调 LLM 生成自然语言画像"""
    # LLM 配置: 走本地 /api/llm/proxy, 用默认 (复用前端 localStorage 配置无法在后端直接拿到,
    # 所以这里要求调用方已经启动了主服务; 实际调用走环境变量兜底)
    import os

    api_key = os.environ.get('DUNCREW_LLM_KEY') or os.environ.get('OPENAI_API_KEY')
    base_url = os.environ.get('DUNCREW_LLM_URL') or 'https://api.openai.com/v1/chat/completions'
    model = os.environ.get('DUNCREW_LLM_MODEL') or 'gpt-4o-mini'

    if not api_key:
        # 没配就返回默认骨架 (用户可以手动编辑)
        return {
            'opening': '(未配置 DUNCREW_LLM_KEY, 请手动编辑)',
            'sentenceStyle': f"平均句长 {metrics.get('avgSentenceLen', 0)} 字",
            'rhetoric': '',
            'vocabulary': '',
            'paragraphing': f"平均段长 {metrics.get('avgParagraphLen', 0)} 字",
            'citation': '',
            'closing': '',
            'avoid': '',
        }

    metrics_str = json.dumps(metrics, ensure_ascii=False, indent=2)
    snippet = text[:6000]
    system_prompt = (
        "你是一个文风分析师。根据给定的文章样本和结构化指标, 归纳出一份自然语言的'文风画像'。"
        "画像必须具体、可操作, 让另一个 AI 看到后能照着写出相同风格的新文章。"
        "每个维度 1-3 句话, 不要空泛。只输出 JSON, 不要其他内容。"
    )
    user_prompt = f"""风格命名: {name}

## 结构化指标
```json
{metrics_str}
```

## 文章样本 (前 6000 字)
{snippet}

## 任务
输出一份 JSON, 包含以下字段 (每个都是字符串):
- opening: 开篇风格 (如何起笔)
- sentenceStyle: 句式特点 (长短、节奏、整散)
- rhetoric: 修辞偏好 (比喻、对仗、排比、反问等)
- vocabulary: 词汇倾向 (书面/口语、专业/通俗、成语使用)
- paragraphing: 段落组织 (长短、过渡、层次)
- citation: 引用方式 (如果有)
- closing: 收束风格 (如何收尾)
- avoid: 明确避免的表达 (作者从不用的手法)

只输出 JSON, 不要代码块包裹, 不要前后解释。"""

    payload = {
        'model': model,
        'messages': [
            {'role': 'system', 'content': system_prompt},
            {'role': 'user', 'content': user_prompt},
        ],
        'temperature': 0.3,
        'max_tokens': 1500,
    }
    req = urllib.request.Request(
        base_url,
        data=json.dumps(payload).encode('utf-8'),
        headers={
            'Content-Type': 'application/json',
            'Authorization': f'Bearer {api_key}',
        },
        method='POST',
    )

    try:
        with urllib.request.urlopen(req, timeout=90) as resp:
            body = resp.read().decode('utf-8')
            result = json.loads(body)
            content = result['choices'][0]['message']['content'].strip()
            # 去掉可能的代码块
            content = re.sub(r'^```(?:json)?\s*|\s*```$', '', content.strip(), flags=re.MULTILINE).strip()
            profile = json.loads(content)
            # 只保留预期字段
            allowed = {'opening', 'sentenceStyle', 'rhetoric', 'vocabulary',
                       'paragraphing', 'citation', 'closing', 'avoid'}
            return {k: str(v) for k, v in profile.items() if k in allowed and v}
    except Exception as e:
        return {
            'opening': f'(LLM 调用失败: {e}, 请手动编辑)',
            'sentenceStyle': f"平均句长 {metrics.get('avgSentenceLen', 0)} 字",
            'rhetoric': '',
            'vocabulary': '',
            'paragraphing': '',
            'citation': '',
            'closing': '',
            'avoid': '',
        }


def _select_samples(documents: list, max_samples: int = 3) -> list:
    """Layer 3: 选择最具代表性的范文片段 (启发式: 段长 300-600, 包含完整句)"""
    candidates = []  # [(score, text, source)]
    for doc in documents:
        paras = [p.strip() for p in re.split(r'\n\s*\n', doc['text']) if p.strip()]
        for p in paras:
            length = len(p)
            if length < 150 or length > 800:
                continue
            # 评分: 长度靠近 400 得分高 + 含句末标点数量
            length_score = 1.0 - abs(length - 400) / 400
            punct_count = sum(p.count(c) for c in '。！？')
            sent_density = min(1.0, punct_count / 4.0)
            score = length_score * 0.6 + sent_density * 0.4
            candidates.append((score, p, doc.get('title', '')))

    # 去相似 (简单前缀判重)
    candidates.sort(key=lambda x: -x[0])
    picked = []
    seen_prefix = set()
    for score, text, source in candidates:
        prefix = text[:20]
        if prefix in seen_prefix:
            continue
        seen_prefix.add(prefix)
        picked.append({
            'text': text,
            'source': source,
            'reason': f'代表性得分 {score:.2f} (长度 {len(text)} 字)',
        })
        if len(picked) >= max_samples:
            break
    return picked
