#!/usr/bin/env python3
"""
Browser Automation Skill - Main entry point.
Dispatches browser action requests to the Playwright controller.
"""

import sys
import json
import os

# Add parent directories to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from browser.controller import execute_action, run_async, PLAYWRIGHT_AVAILABLE


def main():
    """Main entry point for the browser automation skill."""
    try:
        # Check if Playwright is available
        if not PLAYWRIGHT_AVAILABLE:
            print(json.dumps({
                'success': False,
                'error': 'Playwright is not installed. Install with: pip install playwright && playwright install chromium'
            }))
            sys.exit(1)
        
        # Read input from stdin
        input_data = json.loads(sys.stdin.read())
        
        tool_name = input_data.get('tool')
        args = input_data.get('args', {})
        
        if not tool_name:
            print(json.dumps({
                'success': False,
                'error': 'Tool name is required'
            }))
            sys.exit(1)
        
        # Execute the action
        result = run_async(execute_action(tool_name, args))
        
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
