#!/usr/bin/env python3
"""
Tree-sitter based AST search engine for code-search skill.
Provides accurate symbol lookup (definitions, references, calls).
"""

import os
from pathlib import Path
from typing import List, Dict, Any, Optional, Set
import re

# Try to import tree-sitter-languages (provides pre-built parsers)
try:
    import tree_sitter_languages
    TREE_SITTER_AVAILABLE = True
except ImportError:
    TREE_SITTER_AVAILABLE = False


class TreeSitterEngine:
    """AST-based symbol search using tree-sitter."""
    
    # Language detection by file extension
    EXTENSION_TO_LANGUAGE = {
        '.py': 'python',
        '.ts': 'typescript',
        '.tsx': 'tsx',
        '.js': 'javascript',
        '.jsx': 'javascript',
        '.rs': 'rust',
        '.go': 'go',
        '.java': 'java',
        '.c': 'c',
        '.h': 'c',
        '.cpp': 'cpp',
        '.hpp': 'cpp',
        '.cc': 'cpp',
        '.rb': 'ruby',
    }
    
    # Node types for different languages that represent definitions
    DEFINITION_NODES = {
        'python': {
            'function': ['function_definition'],
            'class': ['class_definition'],
            'variable': ['assignment', 'augmented_assignment'],
        },
        'typescript': {
            'function': ['function_declaration', 'method_definition', 'arrow_function'],
            'class': ['class_declaration', 'interface_declaration', 'type_alias_declaration'],
            'variable': ['variable_declarator', 'lexical_declaration'],
        },
        'javascript': {
            'function': ['function_declaration', 'method_definition', 'arrow_function'],
            'class': ['class_declaration'],
            'variable': ['variable_declarator'],
        },
    }
    
    def __init__(self, project_root: str):
        self.project_root = Path(project_root)
        self.available = TREE_SITTER_AVAILABLE
        self._parser_cache: Dict[str, Any] = {}
    
    def _get_parser(self, language: str):
        """Get or create parser for a language."""
        if not self.available:
            return None
        
        if language not in self._parser_cache:
            try:
                parser = tree_sitter_languages.get_parser(language)
                self._parser_cache[language] = parser
            except Exception:
                return None
        
        return self._parser_cache.get(language)
    
    def search_symbol(
        self,
        symbol: str,
        relation: str = 'definition',
        scope: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        Search for symbol definitions and references.
        
        Args:
            symbol: Symbol name to search for
            relation: Type of relationship ('definition', 'calls', 'called_by', 'references')
            scope: Directory to search in
            
        Returns:
            List of symbol locations
        """
        if not self.available:
            return self._fallback_search(symbol, relation, scope)
        
        results = []
        search_path = self.project_root
        if scope:
            search_path = self.project_root / scope
        
        # Walk through files
        for filepath in self._iter_source_files(search_path):
            lang = self._detect_language(filepath)
            if not lang:
                continue
            
            parser = self._get_parser(lang)
            if not parser:
                continue
            
            try:
                with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
                    code = f.read()
                
                tree = parser.parse(code.encode('utf-8'))
                matches = self._search_in_tree(tree, code, symbol, relation, lang)
                
                for match in matches:
                    try:
                        rel_path = str(filepath.relative_to(self.project_root))
                    except ValueError:
                        rel_path = str(filepath)
                    
                    match['file'] = rel_path
                    results.append(match)
                    
            except Exception as e:
                continue
        
        return results
    
    def _iter_source_files(self, root: Path) -> List[Path]:
        """Iterate over source files, skipping ignored directories."""
        ignore_dirs = {'.git', 'node_modules', '__pycache__', 'venv', 'dist', 'build', '.next', 'target'}
        
        files = []
        for dirpath, dirnames, filenames in os.walk(root):
            # Filter out ignored directories
            dirnames[:] = [d for d in dirnames if d not in ignore_dirs and not d.startswith('.')]
            
            for filename in filenames:
                filepath = Path(dirpath) / filename
                if filepath.suffix in self.EXTENSION_TO_LANGUAGE:
                    files.append(filepath)
        
        return files
    
    def _detect_language(self, filepath: Path) -> Optional[str]:
        """Detect language from file extension."""
        return self.EXTENSION_TO_LANGUAGE.get(filepath.suffix)
    
    def _search_in_tree(
        self,
        tree,
        code: str,
        symbol: str,
        relation: str,
        language: str
    ) -> List[Dict[str, Any]]:
        """Search for symbol in parsed tree."""
        results = []
        code_bytes = code.encode('utf-8')
        
        def visit_node(node, parent_name=None):
            """Recursively visit nodes."""
            node_type = node.type
            
            # Get node text
            start = node.start_byte
            end = node.end_byte
            node_text = code_bytes[start:end].decode('utf-8', errors='ignore')
            
            # Check for symbol matches based on relation type
            if relation == 'definition':
                # Look for definition nodes
                if self._is_definition_node(node_type, language):
                    name = self._extract_definition_name(node, code_bytes)
                    if name and self._matches_symbol(name, symbol):
                        results.append({
                            'line': node.start_point[0] + 1,
                            'column': node.start_point[1],
                            'match': self._get_line_at(code, node.start_point[0]),
                            'symbol_name': name,
                            'symbol_type': self._get_symbol_type(node_type),
                            'relation': 'definition',
                        })
                        
            elif relation == 'calls':
                # Look for function calls
                if node_type in ['call_expression', 'call']:
                    callee = self._extract_callee_name(node, code_bytes)
                    if callee and self._matches_symbol(callee, symbol):
                        results.append({
                            'line': node.start_point[0] + 1,
                            'column': node.start_point[1],
                            'match': self._get_line_at(code, node.start_point[0]),
                            'symbol_name': callee,
                            'relation': 'call',
                            'context': parent_name,
                        })
                        
            elif relation == 'references':
                # Look for any identifier usage
                if node_type == 'identifier' and node_text == symbol:
                    results.append({
                        'line': node.start_point[0] + 1,
                        'column': node.start_point[1],
                        'match': self._get_line_at(code, node.start_point[0]),
                        'symbol_name': symbol,
                        'relation': 'reference',
                    })
            
            # Track current function/class name for context
            current_name = parent_name
            if self._is_definition_node(node_type, language):
                extracted = self._extract_definition_name(node, code_bytes)
                if extracted:
                    current_name = extracted
            
            # Recursively visit children
            for child in node.children:
                visit_node(child, current_name)
        
        visit_node(tree.root_node)
        return results
    
    def _is_definition_node(self, node_type: str, language: str) -> bool:
        """Check if node type is a definition."""
        lang_defs = self.DEFINITION_NODES.get(language, {})
        for category, types in lang_defs.items():
            if node_type in types:
                return True
        return False
    
    def _get_symbol_type(self, node_type: str) -> str:
        """Get human-readable symbol type from node type."""
        if 'function' in node_type or 'method' in node_type:
            return 'function'
        elif 'class' in node_type:
            return 'class'
        elif 'interface' in node_type:
            return 'interface'
        elif 'type' in node_type:
            return 'type'
        elif 'variable' in node_type or 'assignment' in node_type:
            return 'variable'
        return 'symbol'
    
    def _extract_definition_name(self, node, code_bytes: bytes) -> Optional[str]:
        """Extract the name from a definition node."""
        # Look for 'name' or 'identifier' child
        for child in node.children:
            if child.type in ['identifier', 'name', 'property_identifier']:
                return code_bytes[child.start_byte:child.end_byte].decode('utf-8', errors='ignore')
        
        # For some nodes, look deeper
        for child in node.children:
            if child.type in ['function_declarator', 'declarator']:
                for grandchild in child.children:
                    if grandchild.type == 'identifier':
                        return code_bytes[grandchild.start_byte:grandchild.end_byte].decode('utf-8', errors='ignore')
        
        return None
    
    def _extract_callee_name(self, node, code_bytes: bytes) -> Optional[str]:
        """Extract the function name from a call expression."""
        for child in node.children:
            if child.type in ['identifier', 'member_expression']:
                text = code_bytes[child.start_byte:child.end_byte].decode('utf-8', errors='ignore')
                # For member expressions like obj.method, get the last part
                if '.' in text:
                    return text.split('.')[-1]
                return text
            elif child.type == 'function':
                return self._extract_callee_name(child, code_bytes)
        return None
    
    def _matches_symbol(self, name: str, pattern: str) -> bool:
        """Check if name matches the search pattern."""
        if not name:
            return False
        # Exact match
        if name == pattern:
            return True
        # Case-insensitive match
        if name.lower() == pattern.lower():
            return True
        # Partial match (for prefix/suffix searches)
        if pattern.endswith('*') and name.startswith(pattern[:-1]):
            return True
        if pattern.startswith('*') and name.endswith(pattern[1:]):
            return True
        return False
    
    def _get_line_at(self, code: str, line_index: int) -> str:
        """Get a specific line from code."""
        lines = code.split('\n')
        if 0 <= line_index < len(lines):
            return lines[line_index].strip()
        return ''
    
    def _fallback_search(
        self,
        symbol: str,
        relation: str,
        scope: Optional[str]
    ) -> List[Dict[str, Any]]:
        """
        Fallback regex-based symbol search when tree-sitter is not available.
        """
        results = []
        search_path = self.project_root
        if scope:
            search_path = self.project_root / scope
        
        # Build patterns based on relation
        if relation == 'definition':
            patterns = [
                (re.compile(rf'(function|def|fn|func)\s+{re.escape(symbol)}\s*\(', re.IGNORECASE), 'function'),
                (re.compile(rf'(class|struct|interface)\s+{re.escape(symbol)}[\s{{]', re.IGNORECASE), 'class'),
                (re.compile(rf'(const|let|var|val)\s+{re.escape(symbol)}\s*[=:]', re.IGNORECASE), 'variable'),
            ]
        elif relation == 'calls':
            patterns = [
                (re.compile(rf'{re.escape(symbol)}\s*\('), 'call'),
            ]
        else:  # references
            patterns = [
                (re.compile(rf'\b{re.escape(symbol)}\b'), 'reference'),
            ]
        
        for filepath in self._iter_source_files(search_path):
            try:
                with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
                    lines = f.readlines()
                
                for i, line in enumerate(lines, 1):
                    for pattern, sym_type in patterns:
                        if pattern.search(line):
                            try:
                                rel_path = str(filepath.relative_to(self.project_root))
                            except ValueError:
                                rel_path = str(filepath)
                            
                            results.append({
                                'file': rel_path,
                                'line': i,
                                'match': line.strip(),
                                'symbol_name': symbol,
                                'symbol_type': sym_type,
                                'relation': relation,
                            })
                            break  # Only one match per line
                            
            except Exception:
                continue
        
        return results


if __name__ == '__main__':
    import json
    import sys
    
    if len(sys.argv) > 1:
        symbol = sys.argv[1]
        relation = sys.argv[2] if len(sys.argv) > 2 else 'definition'
        
        engine = TreeSitterEngine('.')
        results = engine.search_symbol(symbol, relation)
        print(json.dumps(results, indent=2, ensure_ascii=False))
