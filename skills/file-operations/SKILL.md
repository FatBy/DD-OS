# File Operations Skill

Read, write, and manage files on the local system.

## Usage

### Read a file
```json
{"tool": "readFile", "args": {"path": "path/to/file.txt"}}
```

### Write a file
```json
{"tool": "writeFile", "args": {"path": "path/to/file.txt", "content": "file content here"}}
```

### Append to file
```json
{"tool": "appendFile", "args": {"path": "path/to/file.txt", "content": "content to append"}}
```

### List directory
```json
{"tool": "listDir", "args": {"path": "./some/directory"}}
```

## Notes

- Use relative paths from project root
- Always check if file exists before reading
- Be careful with write operations - they overwrite existing content
