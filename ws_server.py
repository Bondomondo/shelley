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

PORT = 7700
log = logging.getLogger(__name__)


class WSBroadcaster:
    def __init__(self):
        self._clients: set = set()
        self._loop: asyncio.AbstractEventLoop | None = None
        self._ready = threading.Event()

    # ── Public API (call from any thread) ────────────────────────────────────

    def emit(self, event: dict):
        """Broadcast a JSON event to all connected clients (thread-safe)."""
        if not _HAS_WS or self._loop is None:
            return
        payload = json.dumps(event)
        asyncio.run_coroutine_threadsafe(self._broadcast(payload), self._loop)

    def start(self):
        """Start the WebSocket server in a background daemon thread."""
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
        try:
            await ws.wait_closed()
        finally:
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
