"""扫描 skills 目录，检测漏 import 的 stdlib 模块（同 sys/MAX_OUTPUT_SIZE 那类系统性 NameError Bug）。

不算"问题"，只是潜在风险——本地变量或类属性同名时 AST 静态分析会误报，所以输出后还要人工过一眼。
"""
import ast
import sys
from pathlib import Path

SKILLS_DIR = Path(r"D:\编程\DunCrew-Data\skills")
STDLIB_TO_CHECK = ["sys", "os", "json", "re", "time", "subprocess", "traceback", "asyncio"]


def collect_used_and_imported(tree: ast.AST):
    used = set()
    imported = set()
    assigned_names = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for n in node.names:
                imported.add((n.asname or n.name).split(".")[0])
        elif isinstance(node, ast.ImportFrom):
            if node.module:
                imported.add(node.module.split(".")[0])
            for n in node.names:
                imported.add((n.asname or n.name).split(".")[0])
        elif isinstance(node, ast.Attribute):
            v = node.value
            if isinstance(v, ast.Name):
                used.add(v.id)
        elif isinstance(node, ast.Assign):
            for t in node.targets:
                if isinstance(t, ast.Name):
                    assigned_names.add(t.id)
        elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            assigned_names.add(node.name)
    return used, imported, assigned_names


def main():
    issues = []
    syntax_errors = []
    skipped = 0

    for py in SKILLS_DIR.rglob("*.py"):
        sp = str(py)
        if ".backup" in sp or "__pycache__" in sp:
            skipped += 1
            continue
        try:
            text = py.read_text(encoding="utf-8", errors="ignore")
        except Exception as e:
            issues.append((sp, f"READ_ERR:{e}"))
            continue
        try:
            tree = ast.parse(text)
        except SyntaxError as e:
            syntax_errors.append((sp, e.lineno, e.msg))
            continue
        used, imported, assigned = collect_used_and_imported(tree)
        for mod in STDLIB_TO_CHECK:
            if mod in used and mod not in imported and mod not in assigned:
                issues.append((sp, mod))

    print(f"Scanned (skipping .backup/__pycache__): {skipped} files skipped")
    print(f"\n=== SyntaxError ({len(syntax_errors)}) ===")
    for f, line, msg in syntax_errors:
        rel = str(Path(f).relative_to(SKILLS_DIR))
        print(f"  {rel}:{line}  {msg}")
    print(f"\n=== Missing-import suspects ({len(issues)}) ===")
    for f, mod in issues:
        rel = str(Path(f).relative_to(SKILLS_DIR))
        print(f"  [{mod}] {rel}")


if __name__ == "__main__":
    main()
