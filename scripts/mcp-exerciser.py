#!/usr/bin/env python3
"""
A modest MCP exerciser for the Lattakker page. Plain Python 3, nothing to install.

It talks to the dev server's /mcp endpoint like an outside AI would and keeps the page's MCP router busy with a
gentle mix of reads (tabs, cells, the router's own tools), so the Monitor tab's router drawing has something to
show: dots running to the boxes and back. It runs until you press Ctrl+C, then prints what it did.

  1. npm run dev
  2. open http://localhost:5178/?mcp in a browser (the ?mcp is what connects the page to /mcp) and show the Monitor tab
  3. python3 scripts/mcp-exerciser.py

  python3 scripts/mcp-exerciser.py --interval 0.4      busier (about 2 calls a second)
  python3 scripts/mcp-exerciser.py --client brain-demo --model gpt-5  who shows as origin in the traffic: outside-ai:brain-demo@gpt-5
  python3 scripts/mcp-exerciser.py --writes             also writes (and clears) one scratch cell, so the record of changes has entries
  python3 scripts/mcp-exerciser.py --check              do not loop: check that the enhanced MCP works (ids, origin, hops, causes,
                                                         _meta, the record of changes, the router checking itself) and exit 0/1

It never calls the weather, the model on this computer or the helper (no network, no model load), and without
--writes it changes nothing.
"""

import argparse
import json
import random
import re
import sys
import time
import urllib.error
import urllib.request

SCRATCH_TAB = "lab"
SCRATCH_CELL = "Z58"
# Servers that would reach the network or load a model: never touched here.
AVOID = {"weather", "ollama", "helper", "local-ai"}
# Tools that only look (no arguments needed).
LOOKING = re.compile(r"^(list|get|read|stats|catalog|servers|recent|endpoints|history|status|jobs|recall|ping|discover)", re.I)


class Page:
    """The page, reached through the dev server's /mcp endpoint."""

    def __init__(self, url, client, model=None):
        self.url = url
        self.client = client
        self.model = model
        self.origin = f"outside-ai:{client}" + (f"@{model}" if model else "")
        self.next_id = 1
        self.sent = 0

    def headers(self):
        """Who is calling: the page shows it as the origin of the traffic (outside-ai:<client>@<model>)."""
        head = {"content-type": "application/json", "user-agent": self.client, "x-mcp-client": self.client}
        if self.model:
            head["x-mcp-model"] = self.model
        return head

    def rpc(self, method, params=None):
        body = json.dumps({"jsonrpc": "2.0", "id": self.next_id, "method": method, "params": params or {}}).encode()
        self.next_id += 1
        request = urllib.request.Request(
            self.url, data=body, headers=self.headers()
        )
        with urllib.request.urlopen(request, timeout=40) as res:
            text = res.read().decode()
        self.sent += 1
        return json.loads(text) if text else None

    def tool(self, name, **arguments):
        """Calls a tool of the page and returns its answer as a dict. A new participant is first sent to the README."""
        for _ in range(2):
            reply = self.rpc("tools/call", {"name": name, "arguments": arguments})
            if reply is None or "error" in reply:
                return {"ok": False, "error": (reply or {}).get("error", {}).get("message", "no answer")}
            answer = json.loads(reply["result"]["content"][0]["text"])
            if answer.get("orientation") and name not in ("read_readme", "confirm_readme"):
                self.read_readme_once()
                continue
            return answer
        return answer

    def read_readme_once(self):
        part = self.tool("read_readme")
        if part.get("ok"):
            print(f"  first contact: read the README from {part.get('source')} (part 1 of {part.get('parts')})")
        else:
            print(f"  first contact: the README could not be read ({part.get('error')}); confirming instead")
            self.tool("confirm_readme", summary="I am a test script that exercises the MCP router and writes nothing unless asked.")

    def mcp(self, server, method, params=None):
        """A request to a server of the page through its router; returns (ok, result-or-error)."""
        answer = self.tool("mcp_request", server=server, method=method, params=params or {})
        return answer.get("ok") is True, answer.get("result", answer.get("error"))

    def router_tool(self, name, **arguments):
        ok, result = self.mcp("router", "tools/call", {"name": name, "arguments": arguments})
        if ok and isinstance(result, dict):
            return result.get("structuredContent", result)
        return {"error": result}


def connect(page):
    listed = page.rpc("tools/list")
    tools = [t["name"] for t in (listed or {}).get("result", {}).get("tools", [])]
    if not tools:
        sys.exit("No page is connected. Run `npm run dev`, open http://localhost:5178/?mcp in a browser, then try again.")
    return tools


# ---------------------------------------------------------------- the exerciser


class Exerciser:
    def __init__(self, page, writes):
        self.page = page
        self.writes = writes
        self.tabs = []
        self.cells = {}
        self.safe_tools = []
        self.last_id = None
        self.counts = {}
        self.errors = 0
        self.total_ms = 0.0
        self.calls = 0

    def learn(self):
        """What can be asked: the tabs and their cells, and the harmless no-argument tools of the other servers."""
        catalog = self.page.router_tool("catalog")
        for entry in catalog.get("servers", []):
            server = entry["server"]
            if server in AVOID:
                continue
            ok, listed = self.page.mcp(server, "tools/list")
            tools = listed.get("tools", []) if ok and isinstance(listed, dict) else []
            if any(t["name"] == "get_cell" for t in tools):
                self.tabs.append(server)
                ok, cells = self.page.mcp(server, "tools/call", {"name": "list_cells", "arguments": {}})
                found = cells.get("structuredContent", {}).get("cells", []) if ok and isinstance(cells, dict) else []
                self.cells[server] = [c["path"] for c in found] or []
            elif server != "router":
                for t in tools:
                    required = (t.get("inputSchema") or {}).get("required") or []
                    if LOOKING.match(t["name"]) and not required:
                        self.safe_tools.append((server, t["name"]))
        print(f"  knows {len(self.tabs)} tabs ({', '.join(self.tabs)}), {sum(len(c) for c in self.cells.values())} cells, {len(self.safe_tools)} harmless tools")

    def actions(self):
        tab = random.choice(self.tabs) if self.tabs else None
        cell = random.choice(self.cells[tab]) if tab and self.cells.get(tab) else None
        pool = [
            (3, "get_state", lambda: self.page.tool("get_state")),
            (2, "list_tabs", lambda: self.page.tool("list_tabs")),
            (2, "router stats", lambda: self.page.router_tool("stats")),
            (2, "router recent", lambda: self.remember(self.page.router_tool("recent", n=5))),
            (1, "router endpoints", lambda: self.page.router_tool("endpoints")),
            (1, "router history", lambda: self.page.router_tool("history")),
        ]
        if self.last_id:
            pool.append((2, "router trace", lambda: self.page.router_tool("trace", id=self.last_id)))
        if tab:
            pool += [
                (4, f"{tab} resources/list", lambda: self.page.mcp(tab, "resources/list")),
                (3, f"{tab} list_cells", lambda: self.page.mcp(tab, "tools/call", {"name": "list_cells", "arguments": {}})),
                (1, f"{tab} signal", lambda: self.page.mcp(tab, "tools/call", {"name": "signal", "arguments": {"name": "exerciser", "data": self.calls}})),
            ]
        if tab and cell:
            pool += [
                (4, f"{tab} get_cell {cell}", lambda: self.page.mcp(tab, "tools/call", {"name": "get_cell", "arguments": {"address": cell}})),
                (2, f"{tab} flash {cell}", lambda: self.page.mcp(tab, "tools/call", {"name": "flash", "arguments": {"address": cell}})),
                # An answer that is relayed for somebody else: the record shows the whole way.
                (1, f"{tab} get_cell {cell} (relayed)", lambda: self.page.mcp(tab, "tools/call", {"name": "get_cell", "arguments": {"address": cell}, "_meta": {"lattakker/trace": {"origin": "relay-demo-user", "lineage": ["relay-demo-user", "relay-demo-ai"]}}})),
            ]
        for server, name in self.safe_tools:
            pool.append((1, f"{server} {name}", lambda s=server, n=name: self.page.mcp(s, "tools/call", {"name": n, "arguments": {}})))
        if self.writes:
            pool.append((1, f"{SCRATCH_TAB} write {SCRATCH_CELL}", self.write_scratch))
        return pool

    def remember(self, recent):
        messages = recent.get("messages") or []
        if messages:
            self.last_id = messages[-1].get("id")
        return recent

    def write_scratch(self):
        n = self.calls
        self.page.mcp(SCRATCH_TAB, "tools/call", {"name": "set_code", "arguments": {"address": SCRATCH_CELL, "code": f"// written by the exerciser\nspan(4, 1)\nprint('call number {n}')"}})
        time.sleep(0.3)
        return self.page.mcp(SCRATCH_TAB, "tools/call", {"name": "set_code", "arguments": {"address": SCRATCH_CELL, "code": ""}})

    def run(self, interval):
        print("exercising the MCP router, Ctrl+C to stop")
        started = time.time()
        try:
            while True:
                pool = self.actions()
                weight, label, action = random.choices(pool, weights=[a[0] for a in pool])[0]
                t0 = time.time()
                try:
                    result = action()
                    failed = isinstance(result, tuple) and not result[0] or (isinstance(result, dict) and result.get("ok") is False)
                except Exception as err:  # the dev server went away, a timeout ...
                    result, failed = str(err), True
                ms = (time.time() - t0) * 1000
                self.calls += 1
                self.errors += 1 if failed else 0
                self.total_ms += ms
                self.counts[label.split(" ")[0]] = self.counts.get(label.split(" ")[0], 0) + 1
                print(f"{time.strftime('%H:%M:%S')}  {label:<34} {ms:6.0f} ms  {'FAILED' if failed else 'ok'}")
                time.sleep(max(0.05, random.uniform(0.5, 1.5) * interval))
        except KeyboardInterrupt:
            pass
        seconds = max(1, time.time() - started)
        print(f"\nstopped after {seconds:.0f} s: {self.calls} calls ({self.calls / seconds:.1f} per second), {self.errors} failed, {self.total_ms / max(1, self.calls):.0f} ms on average")
        print("  by server:", ", ".join(f"{k} {v}" for k, v in sorted(self.counts.items(), key=lambda kv: -kv[1])))


# ---------------------------------------------------------------- the check of the enhanced MCP

def check(page, writes):
    results = []

    def add(name, ok, detail=""):
        results.append(ok)
        print(f"  {'PASS' if ok else 'FAIL'}  {name}" + (f"  ({detail})" if detail else ""))

    print("1. the router asks itself (tool self_check, run inside the page)")
    report = page.router_tool("self_check")
    for c in report.get("checks", []):
        add(c["name"], c["ok"], c["detail"])
    if not report.get("checks"):
        add("self_check answered", False, str(report.get("error")))

    print("2. an outside caller is recognised: its messages say who it is and how it came in")
    page.mcp("lab", "resources/list")
    recent = page.router_tool("recent", n=40).get("messages", [])
    mine = [m for m in recent if m["kind"] == "request" and m["method"] == "resources/list" and m["to"] == "lab" and m["origin"].startswith("outside-ai:")]
    first = mine[-1] if mine else None
    add("origin is outside-ai:<client name>[@<model>]", bool(first) and first["origin"] == page.origin, first["origin"] if first else "not found")
    add("hops start with the caller and pass the bridge and the router", bool(first) and first["hops"][0] == first["origin"] and "mcp-bridge" in first["hops"] and first["hops"][-2:] == ["router", "lab"], " > ".join(first["hops"]) if first else "")

    print("3. a request relayed for somebody else keeps the whole way")
    page.mcp("lab", "resources/list", {"_meta": {"lattakker/trace": {"origin": "python-relay-test", "lineage": ["python-relay-test", "python-relay-ai"], "id": "zzzz-9"}}})
    recent = page.router_tool("recent", n=40, origin="python-relay-test").get("messages", [])
    relayed = next((m for m in reversed(recent) if m["kind"] == "request"), None)
    add("origin and cause come from _meta", bool(relayed) and relayed["cause"] == "zzzz-9", f"origin {relayed['origin']}, cause {relayed['cause']}" if relayed else "not found")
    add("hops list the relay, then this bridge", bool(relayed) and relayed["hops"][:2] == ["python-relay-test", "python-relay-ai"], " > ".join(relayed["hops"]) if relayed else "")
    if relayed:
        traced = page.router_tool("trace", id=relayed["id"])
        add("tool trace: the way as text", "python-relay-test" in str(traced.get("path")), str(traced.get("path")))

    print("4. the record of changes")
    if not writes:
        print("  (skipped: run with --writes to let the check write and clear one scratch cell, " + f"{SCRATCH_TAB}/{SCRATCH_CELL})")
    else:
        ok, cell = page.mcp(SCRATCH_TAB, "tools/call", {"name": "get_cell", "arguments": {"address": SCRATCH_CELL}})
        existing = (cell.get("structuredContent", {}).get("code") if ok and isinstance(cell, dict) else None) or ""
        if existing.strip():
            print(f"  skipped: {SCRATCH_TAB}/{SCRATCH_CELL} holds code of yours")
        else:
            page.mcp(SCRATCH_TAB, "tools/call", {"name": "set_code", "arguments": {"address": SCRATCH_CELL, "code": "print('one')"}})
            page.mcp(SCRATCH_TAB, "tools/call", {"name": "set_code", "arguments": {"address": SCRATCH_CELL, "code": "print('two')"}})
            history = page.router_tool("history", subject=f"{SCRATCH_TAB}/{SCRATCH_CELL}").get("changes", [])
            last = history[-1] if history else None
            add("history lists the change with who made it", bool(last) and last["by"] == page.origin, last["by"] if last else "empty")
            full = page.router_tool("change", n=last["n"]) if last else {}
            add("change keeps the code from before", full.get("before") == "print('one')" and full.get("after") == "print('two')", f"{full.get('beforeHash')} -> {full.get('afterHash')}")
            page.mcp(SCRATCH_TAB, "tools/call", {"name": "set_code", "arguments": {"address": SCRATCH_CELL, "code": ""}})

    print("5. the endpoints identify themselves")
    ends = page.router_tool("endpoints")
    names = [e["name"] for e in ends.get("endpoints", [])]
    add("this page has a session code and lists its servers", bool(ends.get("page", {}).get("session")) and "router" in names and "lab" in names, f"session {ends.get('page', {}).get('session')}, {len(names)} endpoints")

    passed = sum(1 for r in results if r)
    print(f"\n{passed} of {len(results)} checks passed")
    return all(results)


def main():
    parser = argparse.ArgumentParser(description="Exercises the Lattakker MCP router, or checks the enhanced MCP (--check).")
    parser.add_argument("--url", default="http://localhost:5178/mcp", help="the dev server's MCP endpoint")
    parser.add_argument("--client", default="lattakker-exerciser", help="the name that shows as origin: outside-ai:<name>")
    parser.add_argument("--model", default=None, help="the model behind it, if any: the origin becomes outside-ai:<name>@<model>")
    parser.add_argument("--interval", type=float, default=1.0, help="average seconds between calls (default 1.0)")
    parser.add_argument("--writes", action="store_true", help=f"also write and clear the scratch cell {SCRATCH_TAB}/{SCRATCH_CELL}")
    parser.add_argument("--check", action="store_true", help="check the enhanced MCP once and exit with 0 (all good) or 1")
    args = parser.parse_args()

    page = Page(args.url, args.client, args.model)
    try:
        tools = connect(page)
        print(f"connected: {len(tools)} tools at {args.url}, as '{page.origin}'")
        if args.check:
            sys.exit(0 if check(page, args.writes) else 1)
        ex = Exerciser(page, args.writes)
        ex.learn()
        ex.run(args.interval)
    except urllib.error.URLError as err:
        sys.exit(f"Could not reach {args.url}: {err.reason}. Is `npm run dev` running?")


if __name__ == "__main__":
    main()
