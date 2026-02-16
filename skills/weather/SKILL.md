# Weather Skill

Query weather information for any location.

## Usage

Use the weather tool with a location parameter:

```json
{"tool": "weather", "args": {"location": "city name"}}
```

## Examples

- "What's the weather in Beijing?" -> `{"tool": "weather", "args": {"location": "Beijing"}}`
- "Check temperature in New York" -> `{"tool": "weather", "args": {"location": "New York"}}`

## Notes

- Uses wttr.in API (no authentication required)
- Returns current conditions and forecast
- Supports Chinese city names
