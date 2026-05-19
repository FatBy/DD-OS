"""DunCrew Server - Episodes Mixin (设计规范 A10)

按 yyyymm 分片存储 SOP 执行 episode。
路径: {clawd_path}/episodes/{yyyymm}/{episodeId}.json
"""
from __future__ import annotations

import os
import json
from pathlib import Path
from datetime import datetime


def _atomic_write_json(path: Path, data) -> None:
    """原子写入：先写 .tmp 再 os.replace"""
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(path.suffix + '.tmp')
    with open(tmp_path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp_path, path)


def _yyyymm_from_episode(data: dict) -> str:
    """从 episode 的 timestamp 解析 yyyymm，否则用当前时间"""
    ts = data.get('timestamp') or data.get('createdAt') or data.get('startedAt')
    if ts:
        try:
            # 支持毫秒时间戳和 ISO 字符串
            if isinstance(ts, (int, float)):
                # 毫秒/秒兼容
                seconds = ts / 1000 if ts > 1e12 else ts
                return datetime.fromtimestamp(seconds).strftime('%Y%m')
            if isinstance(ts, str):
                # ISO 8601 兼容（带 Z）
                clean = ts.replace('Z', '+00:00')
                return datetime.fromisoformat(clean).strftime('%Y%m')
        except Exception:
            pass
    return datetime.now().strftime('%Y%m')


class EpisodesMixin:
    """SOP Episode 存储 Mixin"""

    def handle_episodes_save(self, dun_id: str, data: dict):
        """POST /api/episodes/{dunId} - 按 yyyymm 分片存储 episode"""
        if not data:
            self.send_error_json('Missing episode data', 400)
            return

        episode_id = data.get('episodeId')
        if not episode_id:
            self.send_error_json('Missing episodeId in episode data', 400)
            return

        # 确保 dunId 写入 episode 元数据，便于查询过滤
        if 'dunId' not in data:
            data['dunId'] = dun_id

        yyyymm = _yyyymm_from_episode(data)
        episode_file = self.clawd_path / 'episodes' / yyyymm / f'{episode_id}.json'

        try:
            _atomic_write_json(episode_file, data)
            self.send_json({
                'status': 'ok',
                'episodeId': episode_id,
                'path': f'episodes/{yyyymm}/{episode_id}.json',
            })
        except Exception as e:
            self.send_error_json(f'Failed to save episode: {e}', 500)

    def handle_episodes_query(self, dun_id: str, query: dict):
        """GET /api/episodes/{dunId}?months=3&limit=100 - 查询最近 N 月 episodes"""
        try:
            months = int(query.get('months', ['3'])[0]) if isinstance(query.get('months'), list) else int(query.get('months', 3))
        except (ValueError, TypeError):
            months = 3
        try:
            limit_raw = query.get('limit')
            if isinstance(limit_raw, list):
                limit_raw = limit_raw[0] if limit_raw else None
            limit = int(limit_raw) if limit_raw else None
        except (ValueError, TypeError):
            limit = None

        episodes_root = self.clawd_path / 'episodes'
        if not episodes_root.exists():
            self.send_json([])
            return

        # 取最近 N 个 yyyymm 月份目录（按字典序倒排即时间倒序）
        month_dirs = sorted(
            [p for p in episodes_root.iterdir() if p.is_dir() and len(p.name) == 6 and p.name.isdigit()],
            reverse=True,
        )[:max(months, 1)]

        results = []
        for month_dir in month_dirs:
            for episode_file in month_dir.glob('*.json'):
                try:
                    content = episode_file.read_text(encoding='utf-8')
                    if not content.strip():
                        continue
                    episode = json.loads(content)
                    if episode.get('dunId') == dun_id:
                        results.append(episode)
                except (json.JSONDecodeError, OSError):
                    continue

        # 按时间倒序
        def _sort_key(ep):
            ts = ep.get('timestamp') or ep.get('createdAt') or ep.get('startedAt') or 0
            if isinstance(ts, str):
                try:
                    clean = ts.replace('Z', '+00:00')
                    return datetime.fromisoformat(clean).timestamp()
                except Exception:
                    return 0
            return ts if isinstance(ts, (int, float)) else 0

        results.sort(key=_sort_key, reverse=True)

        if limit and limit > 0:
            results = results[:limit]

        self.send_json(results)
