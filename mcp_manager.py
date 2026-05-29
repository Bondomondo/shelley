"""
mcp_manager.py — manages MCP server connections for AIShell.

Each configured server runs as a persistent background asyncio task.
Sync callers (ai_brain) use call_tool() which bridges into the async loop
via concurrent.futures.Future so the MCP session is reused across calls.

Config: ~/.aishell_mcp.json
"""

import asyncio
import concurrent.futures
import json
import re
import threading
from pathlib import Path

_CONFIG_PATH = Path.home() / ".aishell_mcp.json"

try:
    from mcp import ClientSession, StdioServerParameters
    from mcp.client.stdio import stdio_client
    _HAS_MCP = True
except ImportError:
    _HAS_MCP = False

# ── Tool name encoding ────────────────────────────────────────────────────────
# Claude tool names: ^[a-zA-Z0-9_-]+$, max 64 chars.
# We encode as  mcp__<server>__<tool>  (sanitized).

_SAFE     = re.compile(r"[^a-zA-Z0-9_-]")
_COLLAPSE = re.compile(r"_+")

def _safe(s: str) -> str:
    return _COLLAPSE.sub("_", _SAFE.sub("_", s)).strip("_")[:30]

def encode_tool(server: str, tool: str) -> str:
    return f"mcp__{_safe(server)}__{_safe(tool)}"

def decode_tool(encoded: str) -> tuple[str, str] | None:
    """Return (server_safe, tool_safe) or None if not an MCP tool."""
    if not encoded.startswith("mcp__"):
        return None
    parts = encoded[5:].split("__", 1)
    return (parts[0], parts[1]) if len(parts) == 2 else None


class MCPManager:
    def __init__(self, broadcaster=None):
        self._broadcaster = broadcaster
        self._loop: asyncio.AbstractEventLoop | None = None
        self._ready = threading.Event()
        # server_name -> list[mcp.Tool]
        self._tools: dict[str, list] = {}
        # server_name -> human-readable status
        self._status: dict[str, str] = {}
        # server_name -> asyncio.Queue (call requests)
        self._queues: dict[str, asyncio.Queue] = {}
        # server_name -> asyncio.Task
        self._tasks: dict[str, asyncio.Task] = {}
        # safe_name -> original_name (for reverse lookup)
        self._safe_to_name: dict[str, str] = {}

    # ── Lifecycle ─────────────────────────────────────────────────────────────

    def start(self):
        if not _HAS_MCP:
            print(
                "\n[mcp] 'mcp' package not found — MCP servers unavailable.\n"
                "Run: pip install mcp\n"
            )
            return
        t = threading.Thread(target=self._run_loop, daemon=True, name="mcp-loop")
        t.start()
        self._ready.wait(timeout=3)
        for name in self._load_config().get("servers", {}):
            self.connect(name)

    def _run_loop(self):
        self._loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self._loop)
        self._ready.set()
        self._loop.run_forever()

    # ── Config ────────────────────────────────────────────────────────────────

    @staticmethod
    def _load_config() -> dict:
        if _CONFIG_PATH.exists():
            try:
                return json.loads(_CONFIG_PATH.read_text())
            except Exception:
                return {}
        return {}

    @staticmethod
    def _save_config(data: dict):
        _CONFIG_PATH.write_text(json.dumps(data, indent=2))

    def add_server(self, name: str, server: dict):
        cfg = self._load_config()
        cfg.setdefault("servers", {})[name] = server
        self._save_config(cfg)

    def remove_server(self, name: str) -> bool:
        cfg = self._load_config()
        if name not in cfg.get("servers", {}):
            return False
        del cfg["servers"][name]
        self._save_config(cfg)
        self.disconnect(name)
        return True

    def list_servers(self) -> list[dict]:
        cfg = self._load_config()
        result = []
        for name, server in cfg.get("servers", {}).items():
            result.append({
                "name": name,
                "transport": server.get("transport", "stdio"),
                "status": self._status.get(name, "disconnected"),
                "tools": [t.name for t in self._tools.get(name, [])],
            })
        return result

    # ── Connect / disconnect ──────────────────────────────────────────────────

    def connect(self, name: str) -> bool:
        if not _HAS_MCP or not self._loop:
            return False
        cfg = self._load_config()
        server = cfg.get("servers", {}).get(name)
        if not server:
            return False
        # Cancel existing task if any
        self.disconnect(name)
        q: asyncio.Queue = asyncio.Queue()
        self._queues[name] = q
        self._safe_to_name[_safe(name)] = name
        self._status[name] = "connecting…"
        asyncio.run_coroutine_threadsafe(
            self._launch(name, server, q), self._loop
        )
        return True

    def disconnect(self, name: str):
        if not self._loop:
            return
        task = self._tasks.pop(name, None)
        if task:
            self._loop.call_soon_threadsafe(task.cancel)
        q = self._queues.pop(name, None)
        if q and self._loop:
            asyncio.run_coroutine_threadsafe(q.put(None), self._loop)
        self._tools.pop(name, None)
        self._status[name] = "disconnected"
        self._broadcast_status()

    # ── Async internals ───────────────────────────────────────────────────────

    async def _launch(self, name: str, server: dict, queue: asyncio.Queue):
        task = asyncio.current_task()
        # Re-schedule as a proper task so we can cancel it
        t = asyncio.ensure_future(self._server_task(name, server, queue))
        self._tasks[name] = t

    async def _server_task(self, name: str, server: dict, queue: asyncio.Queue):
        try:
            transport = server.get("transport", "stdio")
            if transport == "stdio":
                params = StdioServerParameters(
                    command=server["command"],
                    args=server.get("args", []),
                    env=server.get("env") or None,
                )
                async with stdio_client(params) as (read, write):
                    await self._run_session(name, read, write, queue)

            elif transport == "sse":
                try:
                    from mcp.client.sse import sse_client
                except ImportError:
                    self._status[name] = "error: sse transport not available"
                    self._broadcast_status()
                    return
                async with sse_client(server["url"]) as (read, write):
                    await self._run_session(name, read, write, queue)

            else:
                self._status[name] = f"error: unknown transport '{transport}'"
                self._broadcast_status()

        except asyncio.CancelledError:
            pass
        except Exception as exc:
            self._status[name] = f"error: {exc}"
            self._tools.pop(name, None)
            self._broadcast_status()

    async def _run_session(self, name: str, read, write, queue: asyncio.Queue):
        async with ClientSession(read, write) as session:
            await session.initialize()
            tool_result = await session.list_tools()
            self._tools[name] = tool_result.tools
            self._status[name] = "connected"
            self._broadcast_status()

            # Serve tool call requests
            while True:
                req = await queue.get()
                if req is None:   # shutdown signal
                    break
                tool_name, tool_input, fut = req
                try:
                    result = await session.call_tool(tool_name, tool_input)
                    # Extract text content
                    if hasattr(result, "content"):
                        parts = []
                        for c in result.content:
                            if hasattr(c, "text"):
                                parts.append(c.text)
                            elif hasattr(c, "data"):
                                parts.append(f"[binary: {len(c.data)} bytes]")
                        text = "\n".join(parts) if parts else "(no output)"
                    else:
                        text = str(result)
                    fut.set_result(text)
                except Exception as exc:
                    fut.set_result(f"Tool error: {exc}")

        self._status[name] = "disconnected"
        self._tools.pop(name, None)
        self._broadcast_status()

    # ── Public sync API for ai_brain ──────────────────────────────────────────

    def get_all_tools(self) -> list[dict]:
        """Return all MCP tools in Claude API format."""
        tools = []
        for server_name, tool_list in self._tools.items():
            if self._status.get(server_name) != "connected":
                continue
            for t in tool_list:
                schema = getattr(t, "inputSchema", None) or {
                    "type": "object", "properties": {}
                }
                tools.append({
                    "name": encode_tool(server_name, t.name),
                    "description": f"[MCP:{server_name}] {t.description or ''}",
                    "input_schema": schema,
                })
        return tools

    def call_tool(self, encoded_name: str, tool_input: dict) -> str:
        """Synchronously call an MCP tool. Returns result text."""
        decoded = decode_tool(encoded_name)
        if not decoded:
            return f"Error: '{encoded_name}' is not an MCP tool"
        safe_server, tool_name = decoded

        # Resolve safe name back to actual server name
        actual_name = self._safe_to_name.get(safe_server, safe_server)
        queue = self._queues.get(actual_name)
        if not queue:
            return f"Error: MCP server '{actual_name}' not connected"

        # Find the original tool name (un-sanitized)
        original_tool = tool_name
        for t in self._tools.get(actual_name, []):
            if _safe(t.name) == tool_name:
                original_tool = t.name
                break

        fut: concurrent.futures.Future = concurrent.futures.Future()
        asyncio.run_coroutine_threadsafe(
            queue.put((original_tool, tool_input, fut)), self._loop
        )
        try:
            return fut.result(timeout=30)
        except concurrent.futures.TimeoutError:
            return "Error: MCP tool call timed out"
        except Exception as exc:
            return f"Error: {exc}"

    # ── Status broadcast ──────────────────────────────────────────────────────

    def _broadcast_status(self):
        if self._broadcaster:
            self._broadcaster.emit({
                "type": "mcp_status",
                "servers": self.list_servers(),
            })
