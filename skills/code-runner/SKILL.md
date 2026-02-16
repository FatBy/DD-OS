# Code Runner Skill

Execute shell commands and scripts.

## Usage

Use the runCmd tool to execute commands:

```json
{"tool": "runCmd", "args": {"command": "your command here"}}
```

## Examples

- Run a script: `{"tool": "runCmd", "args": {"command": "python script.py"}}`
- Check system info: `{"tool": "runCmd", "args": {"command": "systeminfo"}}`
- List processes: `{"tool": "runCmd", "args": {"command": "tasklist"}}`

## Safety Rules

1. Never execute destructive commands without user confirmation
2. Avoid commands that modify system settings
3. Be careful with commands that access sensitive data
4. Always explain what a command will do before running it

## Notes

- Commands run in project directory
- Output is captured and returned
- Timeout: 60 seconds by default
