# Web Search Skill

Use the webSearch tool to find information online.

## Usage

When the user asks to search for something, use the webSearch tool:

```json
{"tool": "webSearch", "args": {"query": "your search query here"}}
```

## Examples

- "Search for latest news" -> `{"tool": "webSearch", "args": {"query": "latest news"}}`
- "Find React documentation" -> `{"tool": "webSearch", "args": {"query": "React documentation"}}`

## Notes

- Keep queries concise and specific
- Results come from DuckDuckGo
- Parse the returned HTML to extract relevant information
