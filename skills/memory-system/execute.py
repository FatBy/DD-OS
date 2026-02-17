#!/usr/bin/env python3
"""
Memory System Skill - Main entry point.
Dispatches search_memory and update_memory requests.
"""

import sys
import json
import os

# Add parent directories to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from searcher.unified_search import UnifiedSearch
from manager.crud import MemoryManager


def handle_search_memory(args: dict, project_root: str) -> dict:
    """Handle search_memory tool requests."""
    query = args.get('query', '')
    if not query:
        return {
            'success': False,
            'error': 'Query is required for search'
        }
    
    sources = args.get('sources')
    tags = args.get('tags')
    limit = args.get('limit', 10)
    days = args.get('days', 7)
    
    searcher = UnifiedSearch(project_root)
    results = searcher.search(
        query=query,
        sources=sources,
        tags=tags,
        limit=limit,
        days=days
    )
    
    return {
        'success': True,
        'query': query,
        'count': len(results),
        'results': results
    }


def handle_update_memory(args: dict, project_root: str) -> dict:
    """Handle update_memory tool requests."""
    operation = args.get('operation')
    if not operation:
        return {
            'success': False,
            'error': 'Operation type is required'
        }
    
    manager = MemoryManager(project_root)
    
    if operation == 'create':
        content = args.get('content')
        if not content:
            return {
                'success': False,
                'error': 'Content is required for create operation'
            }
        
        return manager.create(
            content=content,
            target=args.get('target', 'daily'),
            tags=args.get('tags'),
            importance=args.get('importance', 50)
        )
    
    elif operation == 'update':
        memory_id = args.get('id')
        content = args.get('content')
        if not memory_id or not content:
            return {
                'success': False,
                'error': 'Both id and content are required for update operation'
            }
        
        return manager.update(
            memory_id=memory_id,
            content=content,
            tags=args.get('tags')
        )
    
    elif operation == 'delete':
        memory_id = args.get('id')
        if not memory_id:
            return {
                'success': False,
                'error': 'Memory id is required for delete operation'
            }
        
        return manager.delete(memory_id)
    
    elif operation == 'tag':
        memory_id = args.get('id')
        tags = args.get('tags')
        if not memory_id or not tags:
            return {
                'success': False,
                'error': 'Both id and tags are required for tag operation'
            }
        
        # Default to 'add' operation
        tag_operation = args.get('tag_operation', 'add')
        return manager.tag(memory_id, tags, tag_operation)
    
    else:
        return {
            'success': False,
            'error': f'Unknown operation: {operation}'
        }


def main():
    """Main entry point for the memory system skill."""
    try:
        # Read input from stdin
        input_data = json.loads(sys.stdin.read())
        
        tool_name = input_data.get('tool')
        args = input_data.get('args', {})
        project_root = args.pop('project_root', os.getcwd())
        
        if tool_name == 'search_memory':
            result = handle_search_memory(args, project_root)
        elif tool_name == 'update_memory':
            result = handle_update_memory(args, project_root)
        else:
            result = {
                'success': False,
                'error': f'Unknown tool: {tool_name}'
            }
        
        # Output result
        print(json.dumps(result, ensure_ascii=False))
        
    except json.JSONDecodeError as e:
        print(json.dumps({
            'success': False,
            'error': f'Invalid JSON input: {str(e)}'
        }))
        sys.exit(1)
    except Exception as e:
        print(json.dumps({
            'success': False,
            'error': str(e)
        }))
        sys.exit(1)


if __name__ == '__main__':
    main()
