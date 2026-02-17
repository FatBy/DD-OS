#!/usr/bin/env python3
"""
Skill Executor - Main entry point.
Dispatches skill-related requests.
"""

import sys
import json
import os

# Add parent directories to path for imports
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from executor import SkillRunner


def main():
    """Main entry point for the skill executor."""
    try:
        # Read input from stdin
        input_data = json.loads(sys.stdin.read())
        
        tool_name = input_data.get('tool')
        args = input_data.get('args', {})
        project_root = args.pop('project_root', os.getcwd())
        
        runner = SkillRunner(project_root)
        
        if tool_name == 'run_skill':
            skill_name = args.get('skill_name')
            if not skill_name:
                result = {
                    'success': False,
                    'error': 'skill_name is required'
                }
            else:
                skill_args = args.get('args', {})
                result = runner.run(skill_name, skill_args)
        
        elif tool_name == 'list_skills':
            skills = runner.list_skills(
                include_builtin=args.get('include_builtin', True),
                include_custom=args.get('include_custom', True)
            )
            result = {
                'success': True,
                'count': len(skills),
                'skills': skills
            }
        
        elif tool_name == 'get_skill_info':
            skill_name = args.get('skill_name')
            if not skill_name:
                result = {
                    'success': False,
                    'error': 'skill_name is required'
                }
            else:
                info = runner.get_skill_info(skill_name)
                if info:
                    result = {
                        'success': True,
                        **info
                    }
                else:
                    result = {
                        'success': False,
                        'error': f'Skill not found: {skill_name}'
                    }
        
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
