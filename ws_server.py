"""
ws_server.py — WebSocket broadcast server on port 7700.
Runs in a daemon thread so it doesn't block the prompt_toolkit loop.
ai_brain.py calls broadcaster.emit({...}) to push events to all clients.
"""

import asyncio
import json
import logging
import threading

try:
    import websockets
    from websockets.server import serve
    _HAS_WS = True
except ImportError:
    _HAS_WS = False

import os
PORT = int(os.environ.get('AISHELL_WS_PORT', '7700'))
log = logging.getLogger(__name__)


class WSBroadcaster:
    def __init__(self):
        self._clients: set = set()
        self._loop: asyncio.AbstractEventLoop | None = None
        self._ready = threading.Event()
        self._on_connect = None   # callable(emit_fn) called for each new client

    # ── Public API (call from any thread) ────────────────────────────────────

    def set_on_connect(self, callback):
        """Register a callback invoked with a single-client emit fn on each new connection."""
        self._on_connect = callback

    def emit(self, event: dict):
        """Broadcast a JSON event to all connected clients (thread-safe)."""
        if not _HAS_WS or self._loop is None:
            return
        payload = json.dumps(event)
        asyncio.run_coroutine_threadsafe(self._broadcast(payload), self._loop)

    def start(self):
        """Start the WebSocket server in a background daemon thread."""
        if PORT == 0:
            return  # disabled for secondary aishell tabs
        if not _HAS_WS:
            print(
                "\n[ws_server] 'websockets' package not found — "
                "AI context panel will be offline.\n"
                "Run: pip install websockets\n"
            )
            return
        t = threading.Thread(target=self._run, daemon=True, name="ws-server")
        t.start()
        self._ready.wait(timeout=3)

    # ── Internal ─────────────────────────────────────────────────────────────

    def _run(self):
        self._loop = asyncio.new_event_loop()
        asyncio.set_event_loop(self._loop)
        self._loop.run_until_complete(self._serve())

    async def _serve(self):
        async with serve(self._handler, "localhost", PORT):
            self._ready.set()
            await asyncio.Future()  # run forever

    async def _handler(self, ws):
        self._clients.add(ws)
        if self._on_connect:
            def _emit_one(event: dict):
                asyncio.run_coroutine_threadsafe(
                    self._send_one(ws, json.dumps(event)), self._loop
                )
            self._on_connect(_emit_one)
        try:
            await ws.wait_closed()
        finally:
            self._clients.discard(ws)

    async def _send_one(self, ws, payload: str):
        try:
            await ws.send(payload)
        except Exception:
            self._clients.discard(ws)

    async def _broadcast(self, payload: str):
        if not self._clients:
            return
        # websockets ≥ 11 dropped remove_client on error; handle manually
        dead = set()
        for ws in list(self._clients):
            try:
                await ws.send(payload)
            except Exception:
                dead.add(ws)
        self._clients -= dead
