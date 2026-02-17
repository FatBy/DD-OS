#!/usr/bin/env python3
"""
SKILL Execution Engine - Executes parsed skill definitions.

The executor takes a parsed skill definition and executes it by:
1. Validating inputs against the skill's input schema
2. Injecting the skill's instructions into the agent's context
3. Tracking execution for learning and optimization
"""

import os
import json
import time
from pathlib import Path
from datetime import datetime
from typing import Dict, Any, Optional, List

from parser import SkillParser, SkillDiscovery


class SkillExecutor:
    """Executes skill definitions."""
    
    def __init__(self, project_root: str):
        self.project_root = Path(project_root)
        self.discovery = SkillDiscovery(project_root)
        self.parser = SkillParser()
        self.traces_dir = self.project_root / 'memory' / 'exec_traces'
        self.traces_dir.mkdir(parents=True, exist_ok=True)
    
    def execute(
        self,
        skill_name: str,
        args: Optional[Dict[str, Any]] = None,
        context: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Execute a skill.
        
        Args:
            skill_name: Name of the skill to execute
            args: Arguments to pass to the skill
            context: Additional context (project info, etc.)
            
        Returns:
            Execution result with injected instructions
        """
        args = args or {}
        context = context or {}
        start_time = time.time()
        
        # Find the skill
        skill_def = self.discovery.find_skill(skill_name)
        if not skill_def:
            return {
                'success': False,
                'error': f'Skill not found: {skill_name}'
            }
        
        # Validate the skill
        errors = self.parser.validate(skill_def)
        if errors:
            return {
                'success': False,
                'error': f'Invalid skill definition: {", ".join(errors)}'
            }
        
        # Validate inputs
        input_errors = self._validate_inputs(skill_def, args)
        if input_errors:
            return {
                'success': False,
                'error': f'Input validation failed: {", ".join(input_errors)}'
            }
        
        # Build execution context
        exec_context = self._build_context(skill_def, args, context)
        
        # Generate agent instructions
        instructions = self._generate_instructions(skill_def, args, exec_context)
        
        duration = time.time() - start_time
        
        # Log execution trace
        self._log_trace(skill_name, args, True, duration)
        
        return {
            'success': True,
            'skill': skill_name,
            'instructions': instructions,
            'context': exec_context,
            'metadata': skill_def.get('metadata', {}),
            'duration': duration
        }
    
    def _validate_inputs(self, skill_def: Dict[str, Any], args: Dict[str, Any]) -> List[str]:
        """Validate inputs against skill schema."""
        errors = []
        inputs_schema = skill_def.get('metadata', {}).get('inputs', {})
        
        for param_name, param_def in inputs_schema.items():
            if not isinstance(param_def, dict):
                continue
            
            required = param_def.get('required', False)
            param_type = param_def.get('type', 'string')
            
            if required and param_name not in args:
                errors.append(f"Missing required input: {param_name}")
                continue
            
            if param_name in args:
                value = args[param_name]
                # Basic type checking
                if param_type == 'string' and not isinstance(value, str):
                    errors.append(f"Invalid type for {param_name}: expected string")
                elif param_type == 'integer' and not isinstance(value, int):
                    errors.append(f"Invalid type for {param_name}: expected integer")
                elif param_type == 'boolean' and not isinstance(value, bool):
                    errors.append(f"Invalid type for {param_name}: expected boolean")
                elif param_type == 'array' and not isinstance(value, list):
                    errors.append(f"Invalid type for {param_name}: expected array")
                elif param_type == 'object' and not isinstance(value, dict):
                    errors.append(f"Invalid type for {param_name}: expected object")
        
        return errors
    
    def _build_context(
        self,
        skill_def: Dict[str, Any],
        args: Dict[str, Any],
        extra_context: Dict[str, Any]
    ) -> Dict[str, Any]:
        """Build execution context for the skill."""
        return {
            'skill_name': skill_def['metadata'].get('name'),
            'skill_version': skill_def['metadata'].get('version', '1.0.0'),
            'args': args,
            'project_root': str(self.project_root),
            'timestamp': datetime.now().isoformat(),
            **extra_context
        }
    
    def _generate_instructions(
        self,
        skill_def: Dict[str, Any],
        args: Dict[str, Any],
        context: Dict[str, Any]
    ) -> str:
        """Generate agent instructions from skill definition."""
        skill_name = skill_def['metadata'].get('name', 'Unknown')
        description = skill_def.get('description', '')
        instructions = skill_def.get('instructions', '')
        examples = skill_def.get('examples', '')
        notes = skill_def.get('notes', '')
        
        # Format arguments
        args_text = '\n'.join([f"  - {k}: {v}" for k, v in args.items()]) if args else '  (none)'
        
        # Build instruction text
        parts = [
            f"# Executing Skill: {skill_name}",
            "",
            "## Description",
            description,
            "",
            "## Provided Arguments",
            args_text,
            "",
            "## Instructions",
            instructions,
        ]
        
        if examples:
            parts.extend([
                "",
                "## Examples",
                examples
            ])
        
        if notes:
            parts.extend([
                "",
                "## Notes",
                notes
            ])
        
        return '\n'.join(parts)
    
    def _log_trace(
        self,
        skill_name: str,
        args: Dict[str, Any],
        success: bool,
        duration: float
    ):
        """Log execution trace for learning."""
        trace = {
            'skill': skill_name,
            'args': args,
            'success': success,
            'duration': duration,
            'timestamp': datetime.now().isoformat()
        }
        
        # Append to monthly trace file
        month = datetime.now().strftime('%Y-%m')
        trace_file = self.traces_dir / f'{month}.jsonl'
        
        try:
            with open(trace_file, 'a', encoding='utf-8') as f:
                f.write(json.dumps(trace, ensure_ascii=False) + '\n')
        except Exception:
            pass  # Don't fail execution if logging fails


class SkillRunner:
    """High-level skill runner for agent integration."""
    
    def __init__(self, project_root: str):
        self.executor = SkillExecutor(project_root)
        self.discovery = SkillDiscovery(project_root)
    
    def run(self, skill_name: str, args: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """Run a skill and return instructions for the agent."""
        return self.executor.execute(skill_name, args)
    
    def list_skills(
        self,
        include_builtin: bool = True,
        include_custom: bool = True
    ) -> List[Dict[str, Any]]:
        """List all available skills."""
        return self.discovery.discover_all(include_builtin, include_custom)
    
    def get_skill_info(self, skill_name: str) -> Optional[Dict[str, Any]]:
        """Get detailed info about a skill."""
        skill_def = self.discovery.find_skill(skill_name)
        if not skill_def:
            return None
        
        return {
            'name': skill_def['metadata'].get('name'),
            'description': skill_def.get('description', ''),
            'version': skill_def['metadata'].get('version', '1.0.0'),
            'author': skill_def['metadata'].get('author', ''),
            'tags': skill_def['metadata'].get('tags', []),
            'inputs': skill_def['metadata'].get('inputs', {}),
            'outputs': skill_def['metadata'].get('outputs', {}),
            'instructions': skill_def.get('instructions', ''),
            'examples': skill_def.get('examples', ''),
            'notes': skill_def.get('notes', ''),
            'path': skill_def.get('file_path')
        }


if __name__ == '__main__':
    # Test execution
    runner = SkillRunner('.')
    
    # List skills
    skills = runner.list_skills()
    print(f"Found {len(skills)} skills:")
    for s in skills:
        print(f"  - {s['name']}: {s['description'][:50]}...")
