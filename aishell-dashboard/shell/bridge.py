import asyncio
import json
import threading
import time

try:
    import websockets
    _WS_AVAILABLE = True
except ImportError:
    _WS_AVAILABLE = False

_clients = set()
_loop = None


def init_bridge(port: int = 7700) -> None:
    """Start WebSocket server in a background thread."""
    if not _WS_AVAILABLE:
        return

    def run() -> None:
        global _loop
        _loop = asyncio.new_event_loop()
        asyncio.set_event_loop(_loop)
        _loop.run_until_complete(_serve(port))

    t = threading.Thread(target=run, daemon=True)
    t.start()


async def _serve(port: int) -> None:
    async def handler(ws: object) -> None:
        _clients.add(ws)
        try:
            await ws.wait_closed()
        finally:
            _clients.discard(ws)

    async with websockets.serve(handler, "localhost", port):
        await asyncio.Future()  # run forever


def emit_event(event_type: str, payload: dict) -> None:
    """Fire-and-forget send to all connected dashboard clients."""
    if not _loop or not _clients:
        return
    try:
        msg = json.dumps({
            "type": event_type,
            "ts": time.time(),
            **payload,
        })
    except (TypeError, ValueError):
        return
    asyncio.run_coroutine_threadsafe(_broadcast(msg), _loop)


async def _broadcast(msg: str) -> None:
    for ws in list(_clients):
        try:
            await ws.send(msg)
        except Exception:
            _clients.discard(ws)
