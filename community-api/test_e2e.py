"""Community API - End-to-end test suite"""
import urllib.request
import json
import sys

BASE = "http://127.0.0.1:8000"
passed = 0
failed = 0


def api(method, path, body=None):
    url = f"{BASE}{path}"
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method=method)
    try:
        resp = urllib.request.urlopen(req)
        return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def test(name, fn):
    global passed, failed
    try:
        fn()
        print(f"  PASS: {name}")
        passed += 1
    except AssertionError as e:
        print(f"  FAIL: {name} - {e}")
        failed += 1


def t01():
    s, r = api("POST", "/api/traces", {
        "id": "t001", "base_sequence": "EEPVEEPXEEVPEEP",
        "base_distribution": {"E": 8, "P": 3, "V": 2, "X": 1},
        "model": "claude-3.5-sonnet", "provider": "Anthropic",
        "success": True, "duration": 47200, "turn_count": 14, "tool_count": 23,
        "tags": ["refactor", "typescript"], "error_positions": [],
        "contributor": "Agent-A", "source_token": "duncrew_community_v1",
        "idempotency_key": "idem-001"
    })
    assert r["ok"] is True, f"Expected ok=True, got {r}"
    assert "id" in r["data"], f"Missing id in data: {r}"
    print(f"    -> id={r['data']['id']}")


def t02():
    s, r = api("POST", "/api/traces", {
        "id": "t001-dup", "base_sequence": "EEPV",
        "base_distribution": {"E": 2, "P": 1, "V": 1},
        "model": "gpt-4", "provider": "OpenAI",
        "success": True, "duration": 1000, "turn_count": 1, "tool_count": 1,
        "source_token": "duncrew_community_v1", "idempotency_key": "idem-001"
    })
    assert r["ok"] is True
    assert r["data"].get("deduplicated") is True, f"Expected deduplicated=True, got {r}"


def t03():
    s, r = api("POST", "/api/traces", {
        "id": "t002", "base_sequence": "EPEPEPVEPEP",
        "base_distribution": {"E": 5, "P": 4, "V": 1, "X": 0},
        "model": "gpt-4o", "provider": "OpenAI",
        "success": True, "duration": 31500, "turn_count": 10, "tool_count": 15,
        "error_count": 1, "tags": ["bugfix", "python"], "error_positions": [4],
        "contributor": "Dev-42", "source_token": "open_community_v1"
    })
    assert r["ok"] is True


def t04():
    s, r = api("POST", "/api/traces", {
        "id": "t003", "base_sequence": "EPVXEPVX",
        "base_distribution": {"E": 2, "P": 2, "V": 2, "X": 2},
        "model": "deepseek-v3", "provider": "DeepSeek",
        "success": False, "duration": 15800, "turn_count": 8, "tool_count": 10,
        "error_count": 3, "tags": ["experiment"], "error_positions": [2, 5, 7],
        "contributor": "Night-Owl", "source_token": "duncrew_community_v1"
    })
    assert r["ok"] is True


def t05():
    s, r = api("POST", "/api/traces", {
        "id": "t001", "base_sequence": "EEPV",
        "base_distribution": {"E": 2, "P": 1, "V": 1},
        "model": "gpt-4", "provider": "OpenAI",
        "success": True, "duration": 1000, "turn_count": 1, "tool_count": 1,
        "source_token": "duncrew_community_v1"
    })
    assert r["ok"] is False
    assert r["error"]["code"] == "DUPLICATE_ID"


def t06():
    s, r = api("POST", "/api/traces", {
        "id": "bad", "base_sequence": "EEP",
        "base_distribution": {"E": 2, "P": 1},
        "model": "x", "provider": "x",
        "success": True, "duration": 1, "turn_count": 1, "tool_count": 1,
        "source_token": "invalid_token"
    })
    assert s == 400, f"Expected 400, got {s}"


def t07():
    s, r = api("POST", "/api/traces", {
        "id": "bad2", "base_sequence": "ABCDEF",
        "base_distribution": {"E": 1},
        "model": "x", "provider": "x",
        "success": True, "duration": 1, "turn_count": 1, "tool_count": 1,
        "source_token": "duncrew_community_v1"
    })
    assert s == 422, f"Expected 422, got {s}"


def t08():
    s, r = api("GET", "/api/traces")
    total = r["meta"]["total"]
    count = len(r["data"])
    assert total == 3, f"Expected 3 traces, got {total}"
    print(f"    -> total={total}, page_count={count}")


def t09():
    s, r = api("GET", "/api/traces/t002")
    assert r["ok"] is True
    assert r["data"]["model"] == "gpt-4o"
    print(f"    -> model={r['data']['model']}, provider={r['data']['provider']}")


def t10():
    s, r = api("GET", "/api/traces/nonexistent")
    assert r["ok"] is False
    assert r["error"]["code"] == "NOT_FOUND"


def t11():
    s, r = api("POST", "/api/traces/validate", {
        "id": "v001", "base_sequence": "EEPVX",
        "base_distribution": {"E": 2, "P": 1, "V": 1, "X": 1},
        "model": "gpt-4", "provider": "OpenAI",
        "success": True, "duration": 1000, "turn_count": 1, "tool_count": 1,
        "source_token": "duncrew_community_v1"
    })
    assert r["data"]["valid"] is True


def t12():
    s, r = api("GET", "/api/stats")
    d = r["data"]
    assert d["total_traces"] == 3
    assert d["total_contributors"] >= 2
    print(f"    -> traces={d['total_traces']}, rate={d['success_rate']}%, providers={d['provider_distribution']}")


def t13():
    s, r = api("GET", "/api/stats")
    assert r["meta"]["cached"] is True
    print(f"    -> cached={r['meta']['cached']}")


def t14():
    s, r = api("GET", "/api/traces?provider=Anthropic")
    assert r["meta"]["total"] == 1
    print(f"    -> Anthropic count={r['meta']['total']}")


def t15():
    s, r = api("POST", "/api/traces/batch", {
        "traces": [
            {
                "id": "t004", "base_sequence": "EEPEEPEEPEEP",
                "base_distribution": {"E": 8, "P": 4},
                "model": "claude-3.5-sonnet", "provider": "Anthropic",
                "success": True, "duration": 25600, "turn_count": 12, "tool_count": 18,
                "tags": ["automation"], "error_positions": [],
                "contributor": "Builder-7", "source_token": "duncrew_community_v1"
            },
            {
                "id": "t005", "base_sequence": "EEVPEEVP",
                "base_distribution": {"E": 4, "V": 2, "P": 2},
                "model": "gemini-2.0-flash", "provider": "Google",
                "success": True, "duration": 18200, "turn_count": 8, "tool_count": 12,
                "tags": ["web"], "error_positions": [],
                "contributor": "Scout-3", "source_token": "open_community_v1"
            }
        ]
    })
    assert r["ok"] is True
    assert r["meta"]["created"] == 2
    print(f"    -> created={r['meta']['created']}, total={r['meta']['total']}")


def t16():
    s, r = api("GET", "/api/traces?sort=longest")
    first = r["data"][0]
    assert first["id"] == "t001"  # 47200ms is longest
    print(f"    -> longest trace: id={first['id']}, duration={first['duration']}ms")


if __name__ == "__main__":
    print("=" * 50)
    print("DunCrew Community API - E2E Tests")
    print("=" * 50)

    test("01 Create trace", t01)
    test("02 Idempotency (duplicate key skipped)", t02)
    test("03 Create trace 2", t03)
    test("04 Create trace 3 (failure case)", t04)
    test("05 Duplicate ID rejected", t05)
    test("06 Invalid source_token -> 400", t06)
    test("07 Invalid base_sequence -> 422", t07)
    test("08 List all traces (paginated)", t08)
    test("09 Get single trace by ID", t09)
    test("10 Get non-existent trace -> NOT_FOUND", t10)
    test("11 Validate (dry-run)", t11)
    test("12 Stats endpoint", t12)
    test("13 Stats cache hit", t13)
    test("14 Filter by provider", t14)
    test("15 Batch upload (2 traces)", t15)
    test("16 Sort by duration (longest)", t16)

    print()
    print("=" * 50)
    print(f"Results: {passed} passed, {failed} failed")
    print("=" * 50)
    sys.exit(1 if failed > 0 else 0)
