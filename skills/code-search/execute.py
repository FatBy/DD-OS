#!/usr/bin/env python3
"""
Code Search Skill - Main Entry Point

Supports three search modes:
1. Text search (ripgrep) - Fast pattern matching
2. Symbol search (tree-sitter) - AST-based symbol lookup
3. Semantic search (embedding) - Natural language similarity

Protocol:
  Input: stdin JSON {"tool": "search_codebase", "args": {...}}
  Output: stdout JSON {"status": "success", "results": [...]}
"""

import sys
import json
import os
from pathlib import Path
from typing import Dict, Any, Optional

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from engines.ripgrep_engine import RipgrepEngine

# Lazy imports for optional engines
_treesitter_engine = None
_semantic_engine = None


def get_project_root() -> Path:
    """Get project root from environment or default to cwd."""
    root = os.environ.get('DDOS_PROJECT_ROOT', os.getcwd())
    return Path(root)


def search_codebase(args: Dict[str, Any]) -> Dict[str, Any]:
    """
    Search code using text, AST, or semantic modes.
    
    Args:
        query: Search query
        scope: Directory to search in
        language: Language filter
        limit: Max results (default 10)
        mode: 'text', 'semantic', or 'auto'
    """
    query = args.get('query', '')
    if not query:
        return {'status': 'error', 'message': 'query is required'}
    
    scope = args.get('scope')
    language = args.get('language')
    limit = int(args.get('limit', 10))
    mode = args.get('mode', 'auto')
    
    project_root = get_project_root()
    results = []
    
    # Text search (ripgrep)
    if mode in ('text', 'auto'):
        rg_engine = RipgrepEngine(str(project_root))
        text_results = rg_engine.search(
            query=query,
            scope=scope,
            language=language,
            limit=limit
        )
        
        for r in text_results:
            r['source'] = 'ripgrep'
            r['relevance'] = 1.0  # Text matches are highly relevant
        
        results.extend(text_results)
    
    # Semantic search (if mode is semantic or auto with few text results)
    if mode == 'semantic' or (mode == 'auto' and len(results) < limit // 2):
        try:
            semantic_results = _search_semantic(query, scope, language, limit)
            
            # Deduplicate with text results
            existing_files = {(r['file'], r['line']) for r in results}
            for r in semantic_results:
                if (r['file'], r.get('line', 0)) not in existing_files:
                    r['source'] = 'semantic'
                    results.append(r)
                    
        except Exception as e:
            # Semantic search is optional, don't fail
            if mode == 'semantic':
                return {'status': 'error', 'message': f'Semantic search failed: {e}'}
    
    # Sort by relevance and limit
    results.sort(key=lambda x: x.get('relevance', 0.5), reverse=True)
    results = results[:limit]
    
    return {
        'status': 'success',
        'query': query,
        'count': len(results),
        'results': results
    }


def search_symbol(args: Dict[str, Any]) -> Dict[str, Any]:
    """
    Search for symbol definitions and references using AST analysis.
    
    Args:
        symbol: Symbol name to search
        relation: 'definition', 'calls', 'called_by', 'references', 'implements'
        scope: Directory to search in
    """
    symbol = args.get('symbol', '')
    if not symbol:
        return {'status': 'error', 'message': 'symbol is required'}
    
    relation = args.get('relation', 'definition')
    scope = args.get('scope')
    
    project_root = get_project_root()
    
    # Try tree-sitter first
    try:
        ts_results = _search_symbol_treesitter(symbol, relation, scope, project_root)
        if ts_results:
            return {
                'status': 'success',
                'symbol': symbol,
                'relation': relation,
                'count': len(ts_results),
                'results': ts_results
            }
    except Exception as e:
        pass  # Fall through to ripgrep fallback
    
    # Fallback: Use ripgrep with patterns
    rg_engine = RipgrepEngine(str(project_root))
    
    # Build search patterns based on relation
    patterns = _build_symbol_patterns(symbol, relation)
    
    all_results = []
    for pattern, pattern_type in patterns:
        results = rg_engine.search(
            query=pattern,
            scope=scope,
            limit=20
        )
        for r in results:
            r['relation_type'] = pattern_type
        all_results.extend(results)
    
    # Deduplicate and rank
    seen = set()
    unique_results = []
    for r in all_results:
        key = (r['file'], r['line'])
        if key not in seen:
            seen.add(key)
            unique_results.append(r)
    
    return {
        'status': 'success',
        'symbol': symbol,
        'relation': relation,
        'count': len(unique_results),
        'results': unique_results[:20]
    }


def search_files(args: Dict[str, Any]) -> Dict[str, Any]:
    """
    Search for files by name pattern.
    
    Args:
        pattern: Glob pattern (e.g., *.ts, **/*.py)
        path: Directory to search in
    """
    pattern = args.get('pattern', '')
    if not pattern:
        return {'status': 'error', 'message': 'pattern is required'}
    
    path = args.get('path')
    project_root = get_project_root()
    
    rg_engine = RipgrepEngine(str(project_root))
    files = rg_engine.search_files(pattern, path)
    
    return {
        'status': 'success',
        'pattern': pattern,
        'count': len(files),
        'files': files
    }


def _search_semantic(
    query: str,
    scope: Optional[str],
    language: Optional[str],
    limit: int
) -> list:
    """Semantic search using embeddings (lazy loaded)."""
    global _semantic_engine
    
    if _semantic_engine is None:
        try:
            from engines.semantic_engine import SemanticEngine
            _semantic_engine = SemanticEngine(str(get_project_root()))
        except ImportError:
            return []
    
    return _semantic_engine.search(query, scope, language, limit)


def _search_symbol_treesitter(
    symbol: str,
    relation: str,
    scope: Optional[str],
    project_root: Path
) -> list:
    """Symbol search using tree-sitter (lazy loaded)."""
    global _treesitter_engine
    
    if _treesitter_engine is None:
        try:
            from engines.treesitter_engine import TreeSitterEngine
            _treesitter_engine = TreeSitterEngine(str(project_root))
        except ImportError:
            return []
    
    return _treesitter_engine.search_symbol(symbol, relation, scope)


def _build_symbol_patterns(symbol: str, relation: str) -> list:
    """Build regex patterns for symbol search fallback."""
    patterns = []
    
    if relation == 'definition':
        # Function/method definitions
        patterns.append((f'(function|def|fn|func)\\s+{symbol}\\s*\\(', 'function_def'))
        patterns.append((f'(class|struct|interface)\\s+{symbol}[\\s{{]', 'class_def'))
        patterns.append((f'(const|let|var|val)\\s+{symbol}\\s*=', 'variable_def'))
        patterns.append((f'{symbol}\\s*:\\s*\\(', 'arrow_function'))  # TypeScript arrow
        
    elif relation == 'calls':
        # Function calls
        patterns.append((f'{symbol}\\s*\\(', 'function_call'))
        
    elif relation == 'called_by':
        # This is harder - look for function definitions that contain calls
        patterns.append((f'{symbol}\\s*\\(', 'potential_call'))
        
    elif relation == 'references':
        # Any usage of the symbol
        patterns.append((f'\\b{symbol}\\b', 'reference'))
        
    elif relation == 'implements':
        # Interface implementations
        patterns.append((f'implements\\s+.*{symbol}', 'implements'))
        patterns.append((f'extends\\s+{symbol}', 'extends'))
    
    return patterns


def main():
    """Main entry point - read from stdin, dispatch to handler."""
    try:
        input_data = sys.stdin.read()
        if not input_data.strip():
            print(json.dumps({'status': 'error', 'message': 'No input provided'}))
            sys.exit(1)
        
        request = json.loads(input_data)
        tool = request.get('tool', '')
        args = request.get('args', {})
        
        # Dispatch to handler
        handlers = {
            'search_codebase': search_codebase,
            'search_symbol': search_symbol,
            'search_files': search_files,
        }
        
        if tool not in handlers:
            print(json.dumps({
                'status': 'error',
                'message': f'Unknown tool: {tool}. Available: {list(handlers.keys())}'
            }))
            sys.exit(1)
        
        result = handlers[tool](args)
        print(json.dumps(result, ensure_ascii=False))
        sys.exit(0 if result.get('status') == 'success' else 1)
        
    except json.JSONDecodeError as e:
        print(json.dumps({'status': 'error', 'message': f'Invalid JSON: {e}'}))
        sys.exit(1)
    except Exception as e:
        print(json.dumps({'status': 'error', 'message': str(e)}))
        sys.exit(1)


if __name__ == '__main__':
    main()
