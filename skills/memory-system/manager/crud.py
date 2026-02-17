#!/usr/bin/env python3
"""
Memory CRUD operations for create, update, delete, and tag management.
"""

import os
import re
import json
import hashlib
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, Optional, List


class MemoryManager:
    """Manage memory entries in daily logs and persistent memory."""
    
    def __init__(self, project_root: str):
        self.project_root = Path(project_root)
        self.memory_dir = self.project_root / 'memory'
        self.persistent_file = self.project_root / 'MEMORY.md'
        self._ensure_dirs()
    
    def _ensure_dirs(self):
        """Ensure necessary directories exist."""
        self.memory_dir.mkdir(parents=True, exist_ok=True)
    
    def _generate_id(self, content: str) -> str:
        """Generate a unique ID for a memory entry."""
        timestamp = datetime.now().isoformat()
        hash_input = f"{timestamp}:{content[:100]}"
        return hashlib.sha256(hash_input.encode()).hexdigest()[:12]
    
    def create(
        self,
        content: str,
        target: str = 'daily',
        tags: Optional[List[str]] = None,
        importance: int = 50
    ) -> Dict[str, Any]:
        """
        Create a new memory entry.
        
        Args:
            content: Memory content
            target: 'daily' or 'persistent'
            tags: List of tags
            importance: Importance score (0-100)
            
        Returns:
            Operation result with created entry info
        """
        tags = tags or []
        timestamp = datetime.now()
        memory_id = self._generate_id(content)
        
        # Format tags
        tags_str = ''
        if tags:
            tags_str = f" [{', '.join(tags)}]"
        
        # Format importance marker
        importance_marker = ''
        if importance >= 80:
            importance_marker = ' [重要]'
        elif importance >= 60:
            importance_marker = ' [中等]'
        
        # Format entry
        timestamp_str = timestamp.strftime('%Y-%m-%d %H:%M')
        entry = f"- [{memory_id}] ({timestamp_str}){importance_marker}{tags_str} {content}"
        
        if target == 'daily':
            return self._append_to_daily(entry, timestamp, memory_id)
        else:
            return self._append_to_persistent(entry, memory_id)
    
    def _append_to_daily(self, entry: str, timestamp: datetime, memory_id: str) -> Dict[str, Any]:
        """Append entry to daily log file."""
        date_str = timestamp.strftime('%Y-%m-%d')
        log_file = self.memory_dir / f'{date_str}.md'
        
        # Create file with header if doesn't exist
        if not log_file.exists():
            header = f"# Daily Log - {date_str}\n\n"
            log_file.write_text(header, encoding='utf-8')
        
        # Append entry
        with open(log_file, 'a', encoding='utf-8') as f:
            f.write(f"{entry}\n")
        
        return {
            'success': True,
            'id': memory_id,
            'target': 'daily',
            'file': str(log_file.relative_to(self.project_root)),
            'message': f'Memory entry created in daily log ({date_str})'
        }
    
    def _append_to_persistent(self, entry: str, memory_id: str) -> Dict[str, Any]:
        """Append entry to persistent MEMORY.md."""
        # Create file with header if doesn't exist
        if not self.persistent_file.exists():
            header = "# Persistent Memory\n\nLong-term memory entries that should be retained.\n\n"
            self.persistent_file.write_text(header, encoding='utf-8')
        
        # Append entry
        with open(self.persistent_file, 'a', encoding='utf-8') as f:
            f.write(f"{entry}\n")
        
        return {
            'success': True,
            'id': memory_id,
            'target': 'persistent',
            'file': 'MEMORY.md',
            'message': 'Memory entry created in persistent memory'
        }
    
    def update(self, memory_id: str, content: str, tags: Optional[List[str]] = None) -> Dict[str, Any]:
        """
        Update an existing memory entry.
        
        Args:
            memory_id: ID of the memory to update
            content: New content
            tags: New tags (optional)
            
        Returns:
            Operation result
        """
        # Try to find and update in daily logs
        result = self._update_in_daily(memory_id, content, tags)
        if result['success']:
            return result
        
        # Try persistent memory
        result = self._update_in_persistent(memory_id, content, tags)
        if result['success']:
            return result
        
        return {
            'success': False,
            'error': f'Memory entry not found: {memory_id}'
        }
    
    def _update_in_daily(self, memory_id: str, content: str, tags: Optional[List[str]]) -> Dict[str, Any]:
        """Update entry in daily logs."""
        # Search recent daily logs (last 30 days)
        today = datetime.now()
        
        for i in range(30):
            date = today - timedelta(days=i)
            date_str = date.strftime('%Y-%m-%d')
            log_file = self.memory_dir / f'{date_str}.md'
            
            if not log_file.exists():
                continue
            
            try:
                file_content = log_file.read_text(encoding='utf-8')
                
                # Find and replace entry
                pattern = rf'^- \[{re.escape(memory_id)}\].*$'
                if re.search(pattern, file_content, re.MULTILINE):
                    # Build replacement
                    timestamp_str = datetime.now().strftime('%Y-%m-%d %H:%M')
                    tags_str = f" [{', '.join(tags)}]" if tags else ""
                    new_entry = f"- [{memory_id}] ({timestamp_str}){tags_str} {content}"
                    
                    updated = re.sub(pattern, new_entry, file_content, flags=re.MULTILINE)
                    log_file.write_text(updated, encoding='utf-8')
                    
                    return {
                        'success': True,
                        'id': memory_id,
                        'file': str(log_file.relative_to(self.project_root)),
                        'message': f'Memory entry updated in daily log ({date_str})'
                    }
                    
            except Exception as e:
                continue
        
        return {'success': False}
    
    def _update_in_persistent(self, memory_id: str, content: str, tags: Optional[List[str]]) -> Dict[str, Any]:
        """Update entry in persistent memory."""
        if not self.persistent_file.exists():
            return {'success': False}
        
        try:
            file_content = self.persistent_file.read_text(encoding='utf-8')
            
            # Find and replace entry
            pattern = rf'^- \[{re.escape(memory_id)}\].*$'
            if re.search(pattern, file_content, re.MULTILINE):
                # Build replacement
                timestamp_str = datetime.now().strftime('%Y-%m-%d %H:%M')
                tags_str = f" [{', '.join(tags)}]" if tags else ""
                new_entry = f"- [{memory_id}] ({timestamp_str}){tags_str} {content}"
                
                updated = re.sub(pattern, new_entry, file_content, flags=re.MULTILINE)
                self.persistent_file.write_text(updated, encoding='utf-8')
                
                return {
                    'success': True,
                    'id': memory_id,
                    'file': 'MEMORY.md',
                    'message': 'Memory entry updated in persistent memory'
                }
                
        except Exception:
            pass
        
        return {'success': False}
    
    def delete(self, memory_id: str) -> Dict[str, Any]:
        """
        Delete a memory entry.
        
        Args:
            memory_id: ID of the memory to delete
            
        Returns:
            Operation result
        """
        # Try daily logs first
        result = self._delete_from_daily(memory_id)
        if result['success']:
            return result
        
        # Try persistent memory
        result = self._delete_from_persistent(memory_id)
        if result['success']:
            return result
        
        return {
            'success': False,
            'error': f'Memory entry not found: {memory_id}'
        }
    
    def _delete_from_daily(self, memory_id: str) -> Dict[str, Any]:
        """Delete entry from daily logs."""
        from datetime import timedelta
        today = datetime.now()
        
        for i in range(30):
            date = today - timedelta(days=i)
            date_str = date.strftime('%Y-%m-%d')
            log_file = self.memory_dir / f'{date_str}.md'
            
            if not log_file.exists():
                continue
            
            try:
                file_content = log_file.read_text(encoding='utf-8')
                
                # Find and remove entry
                pattern = rf'^- \[{re.escape(memory_id)}\].*\n?'
                if re.search(pattern, file_content, re.MULTILINE):
                    updated = re.sub(pattern, '', file_content, flags=re.MULTILINE)
                    log_file.write_text(updated, encoding='utf-8')
                    
                    return {
                        'success': True,
                        'id': memory_id,
                        'file': str(log_file.relative_to(self.project_root)),
                        'message': f'Memory entry deleted from daily log ({date_str})'
                    }
                    
            except Exception:
                continue
        
        return {'success': False}
    
    def _delete_from_persistent(self, memory_id: str) -> Dict[str, Any]:
        """Delete entry from persistent memory."""
        if not self.persistent_file.exists():
            return {'success': False}
        
        try:
            file_content = self.persistent_file.read_text(encoding='utf-8')
            
            # Find and remove entry
            pattern = rf'^- \[{re.escape(memory_id)}\].*\n?'
            if re.search(pattern, file_content, re.MULTILINE):
                updated = re.sub(pattern, '', file_content, flags=re.MULTILINE)
                self.persistent_file.write_text(updated, encoding='utf-8')
                
                return {
                    'success': True,
                    'id': memory_id,
                    'file': 'MEMORY.md',
                    'message': 'Memory entry deleted from persistent memory'
                }
                
        except Exception:
            pass
        
        return {'success': False}
    
    def tag(
        self,
        memory_id: str,
        tags: List[str],
        operation: str = 'add'
    ) -> Dict[str, Any]:
        """
        Add or remove tags from a memory entry.
        
        Args:
            memory_id: ID of the memory
            tags: Tags to add/remove
            operation: 'add' or 'remove'
            
        Returns:
            Operation result
        """
        # Find the entry
        entry_info = self._find_entry(memory_id)
        if not entry_info:
            return {
                'success': False,
                'error': f'Memory entry not found: {memory_id}'
            }
        
        file_path, entry_line, existing_tags = entry_info
        
        # Modify tags
        if operation == 'add':
            new_tags = list(set(existing_tags + tags))
        else:  # remove
            new_tags = [t for t in existing_tags if t not in tags]
        
        # Update the entry with new tags
        return self._update_entry_tags(file_path, memory_id, new_tags)
    
    def _find_entry(self, memory_id: str) -> Optional[tuple]:
        """Find a memory entry by ID."""
        from datetime import timedelta
        
        # Check daily logs
        today = datetime.now()
        for i in range(30):
            date = today - timedelta(days=i)
            date_str = date.strftime('%Y-%m-%d')
            log_file = self.memory_dir / f'{date_str}.md'
            
            if not log_file.exists():
                continue
            
            try:
                content = log_file.read_text(encoding='utf-8')
                for j, line in enumerate(content.split('\n')):
                    if f'[{memory_id}]' in line:
                        tags = self._extract_tags_from_line(line)
                        return (log_file, j, tags)
            except Exception:
                continue
        
        # Check persistent memory
        if self.persistent_file.exists():
            try:
                content = self.persistent_file.read_text(encoding='utf-8')
                for j, line in enumerate(content.split('\n')):
                    if f'[{memory_id}]' in line:
                        tags = self._extract_tags_from_line(line)
                        return (self.persistent_file, j, tags)
            except Exception:
                pass
        
        return None
    
    def _extract_tags_from_line(self, line: str) -> List[str]:
        """Extract tags from a memory entry line."""
        tags = []
        
        # Extract [tag1, tag2] format
        bracket_match = re.search(r'\[([^\]]+)\]', line)
        if bracket_match:
            # Skip if it's the memory ID
            content = bracket_match.group(1)
            if not re.match(r'^[a-f0-9]+$', content):
                tags.extend([t.strip() for t in content.split(',')])
        
        return tags
    
    def _update_entry_tags(self, file_path: Path, memory_id: str, tags: List[str]) -> Dict[str, Any]:
        """Update tags for an entry in a file."""
        try:
            content = file_path.read_text(encoding='utf-8')
            lines = content.split('\n')
            
            for i, line in enumerate(lines):
                if f'[{memory_id}]' in line:
                    # Parse and rebuild line with new tags
                    # Extract parts: - [id] (timestamp) [tags] content
                    match = re.match(
                        r'^(- \[[a-f0-9]+\] \([^)]+\))(\s*\[[^\]]*\])?\s*(.*)$',
                        line
                    )
                    if match:
                        prefix = match.group(1)
                        entry_content = match.group(3) or ''
                        
                        tags_str = f" [{', '.join(tags)}]" if tags else ""
                        lines[i] = f"{prefix}{tags_str} {entry_content}"
                        
                        file_path.write_text('\n'.join(lines), encoding='utf-8')
                        
                        return {
                            'success': True,
                            'id': memory_id,
                            'tags': tags,
                            'file': str(file_path.relative_to(self.project_root)) if file_path != self.persistent_file else 'MEMORY.md',
                            'message': f'Tags updated for memory entry'
                        }
            
        except Exception as e:
            return {
                'success': False,
                'error': str(e)
            }
        
        return {'success': False, 'error': 'Failed to update tags'}


if __name__ == '__main__':
    import sys
    
    manager = MemoryManager('.')
    
    # Test create
    result = manager.create(
        content='测试记忆条目',
        target='daily',
        tags=['test', 'debug'],
        importance=70
    )
    print(json.dumps(result, indent=2, ensure_ascii=False))
