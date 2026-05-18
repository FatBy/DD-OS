"""锁住 ToolsMixin._resolve_path 的安全边界。

历史背景：parsers.py 曾经持有同名副本，MRO 顺序变动可能让一个有缺陷的版本悄悄
盖住真身。这组测试盯着 ToolsMixin 上的 _resolve_path，未来任何人改动这块路径
解析/沙箱逻辑，回归会立刻在这里炸出来。

只依赖 stdlib 的 unittest，可直接跑：
    python -m unittest tests.test_tools_resolve_path
"""
from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path

# 确保从项目根 import 得到
ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from server.handlers.tools import ToolsMixin  # noqa: E402


class _ResolvePathHost(ToolsMixin):
    """最小宿主：_resolve_path 只读 self.clawd_path，其余依赖一概不需要。"""

    def __init__(self, clawd_path: Path):
        self.clawd_path = clawd_path


class ResolvePathSafetyTests(unittest.TestCase):
    """_resolve_path 的安全合同。"""

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.clawd = Path(self._tmp.name).resolve()
        (self.clawd / "duns").mkdir()
        (self.clawd / "duns" / "demo.txt").write_text("hi", encoding="utf-8")
        self.host = _ResolvePathHost(self.clawd)

    def tearDown(self):
        self._tmp.cleanup()

    # ---- 基础合同 ----

    def test_empty_path_rejected(self):
        with self.assertRaises(ValueError):
            self.host._resolve_path("")

    def test_relative_path_resolves_under_clawd(self):
        resolved = self.host._resolve_path("duns/demo.txt")
        self.assertEqual(resolved, self.clawd / "duns" / "demo.txt")

    def test_leading_slash_is_stripped(self):
        # '/duns/demo.txt' 不应被当作绝对路径，应回到 clawd 下
        resolved = self.host._resolve_path("/duns/demo.txt")
        self.assertEqual(resolved, self.clawd / "duns" / "demo.txt")

    # ---- 沙箱边界（核心安全） ----

    def test_dotdot_traversal_blocked(self):
        with self.assertRaises(PermissionError):
            self.host._resolve_path("../escape.txt")

    def test_deep_dotdot_traversal_blocked(self):
        with self.assertRaises(PermissionError):
            self.host._resolve_path("duns/../../escape.txt")

    def test_absolute_path_blocked_by_default(self):
        # 默认 allow_outside=False，绝对路径会被拼到 clawd_path 下，
        # resolve 后不在 clawd 子树内，应抛 PermissionError
        outside = Path(tempfile.gettempdir()).resolve() / "definitely_outside.txt"
        with self.assertRaises(PermissionError):
            self.host._resolve_path(str(outside))

    # ---- allow_outside 逃生口 ----

    def test_allow_outside_accepts_absolute_path(self):
        with tempfile.NamedTemporaryFile(delete=False) as f:
            outside = Path(f.name).resolve()
        try:
            resolved = self.host._resolve_path(str(outside), allow_outside=True)
            self.assertEqual(resolved, outside)
        finally:
            os.unlink(outside)

    def test_allow_outside_does_not_imply_traversal_via_relative(self):
        # allow_outside=True 时，相对路径仍应回到 clawd 下，不会变成 cwd 解释
        resolved = self.host._resolve_path("duns/demo.txt", allow_outside=True)
        self.assertEqual(resolved, self.clawd / "duns" / "demo.txt")

    # ---- MRO 真身验证 ----

    def test_resolve_path_truly_lives_on_tools_mixin(self):
        # 防止以后又有 mixin 把 _resolve_path 抢回去（parsers.py 历史副本）
        from server.handlers import parsers, tools
        self.assertTrue(hasattr(tools.ToolsMixin, "_resolve_path"))
        self.assertFalse(
            hasattr(parsers.ParsersMixin, "_resolve_path"),
            "ParsersMixin 不应再持有 _resolve_path 副本",
        )


if __name__ == "__main__":
    unittest.main()
