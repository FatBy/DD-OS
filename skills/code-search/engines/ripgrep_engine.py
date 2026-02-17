#!/usr/bin/env python3
"""
Ripgrep-based text search engine for code-search skill.
Uses ripgrep (rg) for fast, recursive text searching.
"""

import subprocess
import json
import os
from pathlib import Path
from typing import List, Dict, Any, Optional


class RipgrepEngine:
    """Text search engine using ripgrep."""
    
    # Language to file extension mapping
    LANGUAGE_MAP = {
        'typescript': ['ts', 'tsx'],
        'javascript': ['js', 'jsx'],
        'python': ['py'],
        'rust': ['rs'],
        'go': ['go'],
        'java': ['java'],
        'c': ['c', 'h'],
        'cpp': ['cpp', 'hpp', 'cc', 'cxx'],
        'css': ['css', 'scss', 'sass', 'less'],
        'html': ['html', 'htm'],
        'json': ['json'],
        'yaml': ['yaml', 'yml'],
        'markdown': ['md'],
    }
    
    def __init__(self, project_root: str):
        self.project_root = Path(project_root)
        self.rg_available = self._check_ripgrep()
    
    def _check_ripgrep(self) -> bool:
        """Check if ripgrep is installed."""
        try:
            result = subprocess.run(
                ['rg', '--version'],
                capture_output=True,
                text=True,
                timeout=5
            )
            return result.returncode == 0
        except (FileNotFoundError, subprocess.TimeoutExpired):
            return False
    
    def search(
        self,
        query: str,
        scope: Optional[str] = None,
        language: Optional[str] = None,
        limit: int = 10,
        context_lines: int = 2
    ) -> List[Dict[str, Any]]:
        """
        Search for text patterns using ripgrep.
        
        Args:
            query: Search pattern (regex supported)
            scope: Directory to search in (relative to project root)
            language: Filter by programming language
            limit: Maximum number of results
            context_lines: Number of context lines before/after match
            
        Returns:
            List of search results with file, line, match, and context
        """
        if not self.rg_available:
            return self._fallback_search(query, scope, language, limit)
        
        # Build ripgrep command
        cmd = ['rg', '--json', '-i']  # JSON output, case insensitive
        
        # Add context lines
        if context_lines > 0:
            cmd.extend(['-C', str(context_lines)])
        
        # Add language filter
        if language and language.lower() in self.LANGUAGE_MAP:
            for ext in self.LANGUAGE_MAP[language.lower()]:
                cmd.extend(['-g', f'*.{ext}'])
        
        # Add max results
        cmd.extend(['-m', str(limit * 3)])  # Get more than needed for ranking
        
        # Add query
        cmd.append(query)
        
        # Add search path
        search_path = self.project_root
        if scope:
            search_path = self.project_root / scope
        cmd.append(str(search_path))
        
        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=30,
                cwd=str(self.project_root)
            )
            
            return self._parse_rg_output(result.stdout, limit)
            
        except subprocess.TimeoutExpired:
            return [{'error': 'Search timed out', 'query': query}]
        except Exception as e:
            return [{'error': str(e), 'query': query}]
    
    def _parse_rg_output(self, output: str, limit: int) -> List[Dict[str, Any]]:
        """Parse ripgrep JSON output into structured results."""
        results = []
        current_match = None
        context_before = []
        context_after = []
        
        for line in output.strip().split('\n'):
            if not line:
                continue
            
            try:
                data = json.loads(line)
                msg_type = data.get('type')
                
                if msg_type == 'match':
                    # Save previous match if exists
                    if current_match:
                        current_match['context_before'] = context_before[-3:]
                        current_match['context_after'] = context_after[:3]
                        results.append(current_match)
                        if len(results) >= limit:
                            break
                    
                    # Start new match
                    match_data = data.get('data', {})
                    path = match_data.get('path', {}).get('text', '')
                    lines = match_data.get('lines', {}).get('text', '').strip()
                    line_num = match_data.get('line_number', 0)
                    
                    # Make path relative
                    try:
                        rel_path = str(Path(path).relative_to(self.project_root))
                    except ValueError:
                        rel_path = path
                    
                    current_match = {
                        'file': rel_path,
                        'line': line_num,
                        'match': lines,
                        'context_before': [],
                        'context_after': [],
                    }
                    context_before = []
                    context_after = []
                    
                elif msg_type == 'context':
                    # Context line
                    ctx_data = data.get('data', {})
                    ctx_text = ctx_data.get('lines', {}).get('text', '').strip()
                    ctx_line = ctx_data.get('line_number', 0)
                    
                    if current_match:
                        if ctx_line < current_match['line']:
                            context_before.append(f"{ctx_line}: {ctx_text}")
                        else:
                            context_after.append(f"{ctx_line}: {ctx_text}")
                    
            except json.JSONDecodeError:
                continue
        
        # Don't forget the last match
        if current_match and len(results) < limit:
            current_match['context_before'] = context_before[-3:]
            current_match['context_after'] = context_after[:3]
            results.append(current_match)
        
        return results
    
    def _fallback_search(
        self,
        query: str,
        scope: Optional[str],
        language: Optional[str],
        limit: int
    ) -> List[Dict[str, Any]]:
        """Fallback search using Python when ripgrep is not available."""
        import re
        
        results = []
        search_path = self.project_root
        if scope:
            search_path = self.project_root / scope
        
        # Get file extensions to search
        extensions = None
        if language and language.lower() in self.LANGUAGE_MAP:
            extensions = self.LANGUAGE_MAP[language.lower()]
        
        # Compile regex
        try:
            pattern = re.compile(query, re.IGNORECASE)
        except re.error:
            # Treat as literal string
            pattern = re.compile(re.escape(query), re.IGNORECASE)
        
        # Walk directory
        for root, dirs, files in os.walk(search_path):
            # Skip hidden and common ignore directories
            dirs[:] = [d for d in dirs if not d.startswith('.') and d not in ['node_modules', '__pycache__', 'venv', 'dist', 'build']]
            
            for filename in files:
                if len(results) >= limit:
                    break
                
                # Check extension filter
                if extensions:
                    ext = filename.rsplit('.', 1)[-1] if '.' in filename else ''
                    if ext not in extensions:
                        continue
                
                filepath = Path(root) / filename
                try:
                    with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
                        lines = f.readlines()
                    
                    for i, line in enumerate(lines, 1):
                        if pattern.search(line):
                            try:
                                rel_path = str(filepath.relative_to(self.project_root))
                            except ValueError:
                                rel_path = str(filepath)
                            
                            results.append({
                                'file': rel_path,
                                'line': i,
                                'match': line.strip(),
                                'context_before': [f"{j}: {lines[j-1].strip()}" for j in range(max(1, i-2), i) if j <= len(lines)],
                                'context_after': [f"{j}: {lines[j-1].strip()}" for j in range(i+1, min(len(lines)+1, i+3))],
                            })
                            
                            if len(results) >= limit:
                                break
                                
                except (IOError, UnicodeDecodeError):
                    continue
            
            if len(results) >= limit:
                break
        
        return results
    
    def search_files(
        self,
        pattern: str,
        path: Optional[str] = None
    ) -> List[str]:
        """
        Search for files by name pattern.
        
        Args:
            pattern: Glob pattern (e.g., *.ts, **/*.py)
            path: Directory to search in
            
        Returns:
            List of matching file paths (relative to project root)
        """
        search_path = self.project_root
        if path:
            search_path = self.project_root / path
        
        results = []
        
        # Use glob for pattern matching
        for match in search_path.glob(pattern):
            if match.is_file():
                try:
                    rel_path = str(match.relative_to(self.project_root))
                except ValueError:
                    rel_path = str(match)
                results.append(rel_path)
        
        return sorted(results)


if __name__ == '__main__':
    # Test the engine
    import sys
    
    if len(sys.argv) > 1:
        query = sys.argv[1]
        engine = RipgrepEngine('.')
        results = engine.search(query, limit=5)
        print(json.dumps(results, indent=2, ensure_ascii=False))
