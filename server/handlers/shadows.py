"""DunCrew Server - Shadows Mixin (设计规范 A10)

Shadow SOP（草稿态 SOP）的创建、查询与原子 promote。
路径:
  {clawd_path}/shadows/{shadowId}.json   - 元数据
  {clawd_path}/shadows/{shadowId}.md     - SOP 内容
  {clawd_path}/duns/{dunId}/versions/{sopVersion}.md - promote 时的旧版备份
"""
from __future__ import annotations

import os
import re
import json
from pathlib import Path
from datetime import datetime


def _atomic_write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + '.tmp')
    with open(tmp_path, 'w', encoding='utf-8') as f:
        f.write(content)
    os.replace(tmp_path, path)


def _atomic_write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + '.tmp')
    with open(tmp_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp_path, path)


def _replace_sop_section(dun_md: str, new_sop_body: str) -> str:
    """在 DUN.md 中替换 ## SOP 区域内容（直到下一个 ## 标题或文件结尾）。

    若无 ## SOP 区域，则在文件尾部追加。
    new_sop_body 应不包含 "## SOP" 标题本身，仅为正文。
    """
    pattern = re.compile(r'(^|\n)## SOP\s*\n', re.IGNORECASE)
    match = pattern.search(dun_md)
    new_section = '\n## SOP\n\n' + new_sop_body.strip() + '\n'
    if not match:
        # 文件末尾追加
        sep = '' if dun_md.endswith('\n') else '\n'
        return dun_md + sep + new_section.lstrip('\n')

    start = match.end()
    # 找下一个二级标题
    next_h2 = re.search(r'\n## [^\n]+\n', dun_md[start:])
    if next_h2:
        end = start + next_h2.start() + 1  # 保留前面的换行
        return dun_md[:match.start()] + new_section + dun_md[end:]
    else:
        # SOP 是最后一节
        return dun_md[:match.start()] + new_section


class ShadowsMixin:
    """Shadow SOP Mixin"""

    def handle_shadows_create(self, dun_id: str, data: dict):
        """POST /api/shadows/{dunId}/create - 创建 shadow SOP"""
        if not data:
            self.send_error_json('Missing shadow data', 400)
            return

        shadow_id = data.get('shadowId')
        sop_content = data.get('sopContent', '')
        if not shadow_id:
            self.send_error_json('Missing shadowId', 400)
            return

        now_iso = datetime.now().isoformat()
        meta = dict(data)
        meta.pop('sopContent', None)
        meta.setdefault('dunId', dun_id)
        meta.setdefault('status', 'active')
        meta.setdefault('createdAt', now_iso)
        meta['updatedAt'] = now_iso

        shadows_dir = self.clawd_path / 'shadows'
        meta_path = shadows_dir / f'{shadow_id}.json'
        md_path = shadows_dir / f'{shadow_id}.md'

        try:
            _atomic_write_text(md_path, sop_content or '')
            _atomic_write_json(meta_path, meta)
            self.send_json({
                'status': 'ok',
                'shadowId': shadow_id,
                'metaPath': f'shadows/{shadow_id}.json',
                'sopPath': f'shadows/{shadow_id}.md',
            })
        except Exception as e:
            self.send_error_json(f'Failed to create shadow: {e}', 500)

    def handle_shadows_promote(self, dun_id: str, data: dict):
        """POST /api/shadows/{dunId}/promote - 原子 promote shadow"""
        if not data:
            self.send_error_json('Missing promote data', 400)
            return

        shadow_id = data.get('shadowId')
        if not shadow_id:
            self.send_error_json('Missing shadowId', 400)
            return

        shadows_dir = self.clawd_path / 'shadows'
        meta_path = shadows_dir / f'{shadow_id}.json'
        md_path = shadows_dir / f'{shadow_id}.md'
        if not meta_path.exists() or not md_path.exists():
            self.send_error_json(f'Shadow not found: {shadow_id}', 404)
            return

        try:
            meta = json.loads(meta_path.read_text(encoding='utf-8'))
            new_sop_body = md_path.read_text(encoding='utf-8')
        except Exception as e:
            self.send_error_json(f'Failed to read shadow: {e}', 500)
            return

        dun_md_path = self.clawd_path / 'duns' / dun_id / 'DUN.md'
        if not dun_md_path.exists():
            self.send_error_json(f'DUN.md not found for {dun_id}', 404)
            return

        try:
            old_dun_md = dun_md_path.read_text(encoding='utf-8')
        except Exception as e:
            self.send_error_json(f'Failed to read DUN.md: {e}', 500)
            return

        # 1) 备份旧版 SOP
        prev_version = data.get('previousSopVersion') or meta.get('previousSopVersion') or datetime.now().strftime('%Y%m%d_%H%M%S')
        backup_path = self.clawd_path / 'duns' / dun_id / 'versions' / f'{prev_version}.md'

        # 2) 替换 SOP 区域，写回 DUN.md
        new_dun_md = _replace_sop_section(old_dun_md, new_sop_body)

        # 3) 更新 shadow 元数据
        sop_version = data.get('sopVersion') or meta.get('sopVersion') or datetime.now().strftime('%Y%m%d_%H%M%S')
        meta['status'] = 'promoted'
        meta['promotedAt'] = datetime.now().isoformat()
        meta['sopVersion'] = sop_version
        meta['previousSopVersion'] = prev_version

        # 4) 回填 PatchEvaluationResult（如 patchId 存在）
        patch_id = data.get('patchId') or meta.get('patchId')
        patch_updated = False
        patch_path = self.clawd_path / 'patches' / f'{patch_id}.json' if patch_id else None
        patch_obj = None
        if patch_path and patch_path.exists():
            try:
                patch_obj = json.loads(patch_path.read_text(encoding='utf-8'))
                patch_obj['evaluationResult'] = {
                    'promoted': True,
                    'promotedAt': meta['promotedAt'],
                    'shadowId': shadow_id,
                    'sopVersion': sop_version,
                }
                patch_obj['status'] = 'promoted'
            except Exception:
                patch_obj = None

        try:
            _atomic_write_text(backup_path, old_dun_md)
            _atomic_write_text(dun_md_path, new_dun_md)
            _atomic_write_json(meta_path, meta)
            if patch_obj is not None and patch_path is not None:
                _atomic_write_json(patch_path, patch_obj)
                patch_updated = True
        except Exception as e:
            self.send_error_json(f'Promote failed during write: {e}', 500)
            return

        self.send_json({
            'success': True,
            'shadowId': shadow_id,
            'sopVersion': sop_version,
            'backedUpTo': str(backup_path.relative_to(self.clawd_path)).replace('\\', '/'),
            'patchUpdated': patch_updated,
        })

    def handle_shadows_pool_get(self, dun_id: str):
        """GET /api/shadows/{dunId}/pool - 查询 active shadow pool"""
        shadows_dir = self.clawd_path / 'shadows'
        if not shadows_dir.exists():
            self.send_json([])
            return

        results = []
        for meta_file in shadows_dir.glob('*.json'):
            try:
                content = meta_file.read_text(encoding='utf-8')
                if not content.strip():
                    continue
                meta = json.loads(content)
                if meta.get('dunId') == dun_id and meta.get('status') == 'active':
                    results.append(meta)
            except (json.JSONDecodeError, OSError):
                continue

        results.sort(key=lambda m: m.get('createdAt', ''), reverse=True)
        self.send_json(results)
