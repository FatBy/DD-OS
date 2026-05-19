"""DunCrew Server - Patches Mixin (设计规范 A10)

SOP Patch（演化提案）的存储与查询。
路径:
  {clawd_path}/patches/{patchId}.json     - 普通 patch
  {clawd_path}/quarantine/{patchId}.json  - 隔离区 patch
"""
from __future__ import annotations

import os
import json
from pathlib import Path
from datetime import datetime


def _atomic_write_json(path: Path, data) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + '.tmp')
    with open(tmp_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp_path, path)


class PatchesMixin:
    """SOP Patch Mixin"""

    def handle_patches_save(self, dun_id: str, data: dict):
        """POST /api/patches/{dunId} - 保存 SOP patch"""
        if not data:
            self.send_error_json('Missing patch data', 400)
            return

        patch_id = data.get('patchId')
        if not patch_id:
            self.send_error_json('Missing patchId', 400)
            return

        if 'dunId' not in data:
            data['dunId'] = dun_id
        data.setdefault('createdAt', datetime.now().isoformat())
        data['updatedAt'] = datetime.now().isoformat()

        patch_path = self.clawd_path / 'patches' / f'{patch_id}.json'

        try:
            _atomic_write_json(patch_path, data)
            self.send_json({
                'status': 'ok',
                'patchId': patch_id,
                'path': f'patches/{patch_id}.json',
            })
        except Exception as e:
            self.send_error_json(f'Failed to save patch: {e}', 500)

    def handle_patches_quarantine(self, data: dict):
        """POST /api/patches/quarantine - 写入隔离区"""
        if not data:
            self.send_error_json('Missing patch data', 400)
            return

        patch_id = data.get('patchId')
        if not patch_id:
            self.send_error_json('Missing patchId', 400)
            return

        data.setdefault('quarantinedAt', datetime.now().isoformat())
        if 'reason' not in data:
            data['reason'] = data.get('reason', 'unspecified')

        q_path = self.clawd_path / 'quarantine' / f'{patch_id}.json'

        try:
            _atomic_write_json(q_path, data)
            self.send_json({
                'status': 'ok',
                'patchId': patch_id,
                'path': f'quarantine/{patch_id}.json',
            })
        except Exception as e:
            self.send_error_json(f'Failed to quarantine patch: {e}', 500)

    def handle_patches_query(self, dun_id: str, query: dict):
        """GET /api/patches/{dunId}?status=proposed - 查询 patches"""
        status_filter = query.get('status')
        if isinstance(status_filter, list):
            status_filter = status_filter[0] if status_filter else None

        patches_dir = self.clawd_path / 'patches'
        if not patches_dir.exists():
            self.send_json([])
            return

        results = []
        for patch_file in patches_dir.glob('*.json'):
            try:
                content = patch_file.read_text(encoding='utf-8')
                if not content.strip():
                    continue
                patch = json.loads(content)
                if patch.get('dunId') != dun_id:
                    continue
                if status_filter and patch.get('status') != status_filter:
                    continue
                results.append(patch)
            except (json.JSONDecodeError, OSError):
                continue

        results.sort(key=lambda p: p.get('createdAt', ''), reverse=True)
        self.send_json(results)
