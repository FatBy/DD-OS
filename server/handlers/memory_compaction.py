"""DunCrew Server - Memory Compaction Service (V10)

替代粗暴的分号拼接合并策略，引入"保真检查 + 语义合并"两段式：

1. 保真检查（preservation check）：
   - 优先使用 wiki_entity.title 作为"语义锚点"，计算合并后文本的实体保留率
   - 冷启动时（entity 为空）fallback 到句数保留率
   - 两者都不通过时拒绝合并，条目保留等待下一轮
2. LLM 合并请求构造（build_compaction_prompt）：
   - 由前端 LLM 完成（后端无 LLM key），此模块只构造 prompt 与入参
   - 主流程：db._merge_oldest 如果合并结果没通过保真检查则 rollback

本模块不直接操作数据库，只提供纯函数。
"""
from __future__ import annotations

import re
from typing import Iterable

# 阈值默认值（可被 server.state._COMPACTION_CONFIG 覆盖）
DEFAULT_ENTITY_RETENTION_MIN = 0.8
DEFAULT_SENTENCE_RETENTION_MIN = 0.6
# 去噪：只保留长度 >= 2 的实体标题，避免 "a"/"的" 之类污染
MIN_ENTITY_TITLE_LEN = 2
# 实体数量下限：少于此值则视为冷启动，走 fallback
MIN_ENTITY_FOR_CHECK = 3


# ============================================
# 公开 API
# ============================================

def check_preservation(
    original_texts: list[str],
    merged_text: str,
    entity_titles: Iterable[str] | None = None,
    entity_retention_min: float = DEFAULT_ENTITY_RETENTION_MIN,
    sentence_retention_min: float = DEFAULT_SENTENCE_RETENTION_MIN,
) -> tuple[bool, dict]:
    """综合保真检查。

    Args:
        original_texts: 被合并的原始条目内容列表（合并前）
        merged_text:    合并后的文本
        entity_titles:  wiki_entity 标题集合（供实体保留率用）
        entity_retention_min: 实体保留率阈值
        sentence_retention_min: 句数保留率阈值（fallback）

    Returns:
        (passed, report)
        passed: 是否通过
        report: {
            'mode': 'entity' | 'sentence',
            'retention': float,
            'threshold': float,
            'matched': int,
            'total': int,
        }
    """
    # 过滤无效输入
    original_texts = [t.strip() for t in original_texts if t and t.strip()]
    merged_text = (merged_text or '').strip()
    if not original_texts or not merged_text:
        return False, {'mode': 'invalid', 'retention': 0.0, 'threshold': 0.0, 'matched': 0, 'total': 0}

    # 构造原始语料
    joined_original = '\n'.join(original_texts).lower()
    merged_lower = merged_text.lower()

    # --- 路径 1: 实体保留率 ---
    if entity_titles:
        relevant = [
            title.strip().lower()
            for title in entity_titles
            if isinstance(title, str) and len(title.strip()) >= MIN_ENTITY_TITLE_LEN
        ]
        # 只统计"原文中确实出现过的实体"，避免用全部实体稀释分母
        relevant_in_original = [t for t in relevant if t in joined_original]

        if len(relevant_in_original) >= MIN_ENTITY_FOR_CHECK:
            matched = sum(1 for t in relevant_in_original if t in merged_lower)
            retention = matched / len(relevant_in_original)
            report = {
                'mode': 'entity',
                'retention': round(retention, 3),
                'threshold': entity_retention_min,
                'matched': matched,
                'total': len(relevant_in_original),
            }
            return retention >= entity_retention_min, report

    # --- 路径 2: 句数保留率 fallback ---
    original_units = _count_semantic_units(original_texts)
    merged_units = _count_semantic_units([merged_text])
    if original_units == 0:
        # 异常：原文没有可计数的语义单元，拒绝合并
        return False, {
            'mode': 'sentence', 'retention': 0.0,
            'threshold': sentence_retention_min, 'matched': 0, 'total': 0,
        }

    retention = min(merged_units / original_units, 1.0)
    report = {
        'mode': 'sentence',
        'retention': round(retention, 3),
        'threshold': sentence_retention_min,
        'matched': merged_units,
        'total': original_units,
    }
    return retention >= sentence_retention_min, report


def fallback_merge(original_texts: list[str], max_chars: int = 500) -> str:
    """无 LLM 时的保守 fallback 合并：去重 + 分号拼接（与原逻辑等价）。

    仅当 LLM 合并失败或不可用时使用，不是首选路径。
    """
    seen: set[str] = set()
    parts: list[str] = []
    for text in original_texts:
        if not text:
            continue
        normalized = text.strip()
        key = normalized.lower()
        if key in seen or not normalized:
            continue
        seen.add(key)
        parts.append(normalized)
    merged = '；'.join(parts)
    if len(merged) > max_chars:
        merged = merged[:max_chars - 3] + '...'
    return merged


def build_compaction_prompt(
    category: str,
    original_texts: list[str],
    entity_titles: Iterable[str] | None = None,
    max_output_chars: int = 400,
) -> str:
    """构造给 LLM 的合并 prompt（由前端调用方实际发给 LLM）。

    后端本身不调用 LLM——此函数仅构造 prompt，真正的 LLM 调用由
    前端（TypeScript）发起，再把合并结果 POST 回后端落库。
    """
    entity_hint = ''
    if entity_titles:
        entities = [t for t in entity_titles if isinstance(t, str) and len(t) >= MIN_ENTITY_TITLE_LEN][:15]
        if entities:
            entity_hint = (
                "\n\n## 关键实体（务必在合并后文本中保留）\n"
                + ', '.join(entities)
            )

    lines = [
        f"你在帮助用户维护分类为 '{category}' 的长期记忆。",
        "以下若干条记忆语义相近，需要你合并为 **一条** 更浓缩、信息量等价的新记忆。",
        "",
        "## 要求",
        "- 保留所有独立事实、偏好、约束条件、时间/数值等具体信息",
        "- 合并同义表述，去除冗余",
        f"- 输出长度 <= {max_output_chars} 字",
        "- 直接输出合并后的内容，不要解释，不要 markdown 代码块",
        "- 如果多条内容之间存在矛盾，保留所有说法并用 '但'/'另有' 明确并列",
        entity_hint,
        "",
        "## 原始条目",
    ]
    for idx, text in enumerate(original_texts, 1):
        lines.append(f"{idx}. {text.strip()}")

    return '\n'.join(lines)


# ============================================
# 内部工具
# ============================================

# 句子分隔符：中英文标点
_SENTENCE_SPLIT_RE = re.compile(r'[。！？!?;；\n]+')


def _count_semantic_units(texts: list[str]) -> int:
    """统计文本里的语义单元数（以句子 + 显著标点分隔）。

    空白文本视为 0。非常短（< 4 字符）的片段不计入，避免 "。。" 刷数。
    """
    count = 0
    for text in texts:
        if not text:
            continue
        parts = _SENTENCE_SPLIT_RE.split(text)
        for part in parts:
            clean = part.strip()
            if len(clean) >= 4:
                count += 1
    return count
