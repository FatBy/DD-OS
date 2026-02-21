--- 
name: rlm-engine 
description: Deep programmatic reasoning over complete conversation history using RLM. Activates only when explicitly requested. 
metadata: {"openclaw":{"emoji":"🧠","requires":{"bins":["uv"],"env":["MOONSHOT_API_KEY"]},"primaryEnv":"MOONSHOT_API_KEY"}} 
version: 4.2.1 
--- 
# RLM Engine — Explicit deep reasoning over history 
## IMPORTANT: Explicit activation only 
This skill ONLY activates when the user EXPLICITLY requests RLM analysis. Do NOT use this skill based on question complexity — let the user decide. 

### Trigger phrases (user must say one of these) 
- `/rlm ` 
- `use RLM to...` 
- `analyze with RLM...` 
- `RLM search...` 
- `deep analysis of...` 

### Examples of activation 
``` 
✓ "/rlm how many times did we discuss Docker?" 
✓ "Use RLM to find patterns in our conversations" 
✓ "Analyze with RLM what topics we covered this month" 
✓ "Deep analysis of all infrastructure decisions" 

✗ "What did we talk about yesterday?" → Use memory_search (no RLM trigger) 
✗ "Find patterns in our chats" → Use memory_search (no explicit RLM request) 
✗ "Summarize our project discussions" → Use memory_search (no explicit RLM request) 
``` 

## Why explicit activation? 
| Tool | Speed | Cost | When to use | 
|------|-------|------|-------------| 
| memory_search (native) | ~100ms | Free | Default for all memory questions | 
| rlm-engine (this skill) | 15-180s | $0.01-0.10 | Only when user explicitly asks | 

The user knows when they need deep analysis and will request it explicitly. Do not try to guess — if they don't say "RLM", use memory_search. 

## What RLM can do that memory_search cannot 
- Execute Python code to count, aggregate, calculate statistics 
- Iterate over ALL sessions (not just top-K matches) 
- Cross-reference data across many sessions programmatically 
- Detect patterns that require reading complete transcripts 

## Invocation 
1. Confirm activation: "Running RLM deep analysis... this can take 15-180 seconds depending on context and model iterations." 
2. Execute: 
```bash 
cd {baseDir} && uv run python src/rlm_bridge.py \ 
  --profile-model cost \ 
  --query "EXACT USER QUESTION (without the /rlm prefix)" 
``` 
3. Handle result JSON: 
   - `status: "ok"` → respond with `response` field 
   - `status: "rate_limited"` → Kimi API limit, suggest waiting or using memory_search 
   - `status: "skipped"` → not enough history 
   - `status: "error"` → inform problem, suggest memory_search as fallback 

## Technical details 
- Models (default profile `cost`): kimi-k2.5 (root) + kimi-k2.5 (sub) + kimi-k2-turbo (fallback) 
- Context: loads up to 30 sessions, 200K characters max (configurable) 
- API: Moonshot API (requires MOONSHOT_API_KEY environment variable) 
- Cost: ~$0.01-0.05 per query (pay-as-you-go)