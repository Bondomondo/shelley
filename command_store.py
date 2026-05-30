"""
command_store.py — persist and retrieve named AI-generated commands.
Stored in ~/.aishell_commands.json
"""

import json
from datetime import datetime
from pathlib import Path

_STORE_PATH = Path.home() / ".aishell_commands.json"


def _load() -> dict:
    if _STORE_PATH.exists():
        try:
            return json.loads(_STORE_PATH.read_text())
        except Exception:
            return {}
    return {}


def _save(data: dict):
    _STORE_PATH.write_text(json.dumps(data, indent=2))


def save_command(name: str, commands: list[str], description: str = ""):
    """Save a named command (list of shell commands run in sequence)."""
    data = _load()
    data[name] = {
        "name": name,
        "commands": commands,
        "description": description,
        "created": datetime.now().isoformat(timespec="seconds"),
    }
    _save(data)


def get_command(name: str) -> dict | None:
    return _load().get(name)


def list_commands() -> list[dict]:
    return list(_load().values())


def delete_command(name: str) -> bool:
    data = _load()
    if name in data:
        del data[name]
        _save(data)
        return True
    return False
