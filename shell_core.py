"""
shell_core.py — system awareness and command execution
"""

import os
import subprocess
import socket
import platform
import shutil
from pathlib import Path
from datetime import datetime

try:
    import psutil
except ImportError:
    psutil = None


class ShellCore:
    def __init__(self):
        self.cwd = Path.cwd()
        self.env = os.environ.copy()
        self.last_exit_code = 0

    # ── Prompt ──────────────────────────────────────────────────────────────

    def build_prompt(self):
        """Return a prompt_toolkit HTML prompt string."""
        user = os.environ.get("USER", "user")
        host = socket.gethostname().split(".")[0]
        path = self._short_path(self.cwd)
        indicator = "✗" if self.last_exit_code != 0 else "›"
        color = "#E24B4A" if self.last_exit_code != 0 else "#5DCAA5"
        return (
            f'<prompt.user>{user}</prompt.user>'
            f'<prompt.at>@</prompt.at>'
            f'<prompt.host>{host}</prompt.host>'
            f'<prompt.sep>:</prompt.sep>'
            f'<prompt.path>{path}</prompt.path>'
            f' <style fg="{color}">{indicator}</style> '
        )

    def _short_path(self, path: Path) -> str:
        try:
            rel = path.relative_to(Path.home())
            return "~/" + str(rel) if str(rel) != "." else "~"
        except ValueError:
            return str(path)

    # ── Execution ────────────────────────────────────────────────────────────

    def run_command(self, command: str) -> dict:
        """
        Execute a shell command. Returns dict with stdout, stderr, exit_code.
        Handles 'cd' specially to persist directory changes.
        """
        command = command.strip()

        # Handle cd internally so cwd persists
        if command.startswith("cd"):
            return self._handle_cd(command)

        try:
            result = subprocess.run(
                command,
                shell=True,
                capture_output=True,
                text=True,
                cwd=str(self.cwd),
                env=self.env,
                timeout=30,
            )
            self.last_exit_code = result.returncode
            return {
                "stdout": result.stdout,
                "stderr": result.stderr,
                "exit_code": result.returncode,
                "command": command,
            }
        except subprocess.TimeoutExpired:
            self.last_exit_code = 1
            return {
                "stdout": "",
                "stderr": f"Command timed out after 30 seconds: {command}",
                "exit_code": 1,
                "command": command,
            }
        except Exception as e:
            self.last_exit_code = 1
            return {
                "stdout": "",
                "stderr": str(e),
                "exit_code": 1,
                "command": command,
            }

    def _handle_cd(self, command: str) -> dict:
        parts = command.split(None, 1)
        target = parts[1].strip() if len(parts) > 1 else str(Path.home())
        target = target.replace("~", str(Path.home()))
        target_path = Path(target)
        if not target_path.is_absolute():
            target_path = self.cwd / target_path
        try:
            target_path = target_path.resolve()
            os.chdir(target_path)
            self.cwd = target_path
            self.last_exit_code = 0
            return {"stdout": "", "stderr": "", "exit_code": 0, "command": command}
        except Exception as e:
            self.last_exit_code = 1
            return {"stdout": "", "stderr": str(e), "exit_code": 1, "command": command}

    # ── System snapshot ──────────────────────────────────────────────────────

    def get_system_snapshot(self) -> dict:
        """Gather live system info to feed into the AI's context."""
        snap = {
            "cwd": str(self.cwd),
            "user": os.environ.get("USER", "unknown"),
            "hostname": socket.gethostname(),
            "os": platform.platform(),
            "python": platform.python_version(),
            "shell_env": os.environ.get("SHELL", "/bin/bash"),
            "home": str(Path.home()),
            "timestamp": datetime.now().isoformat(),
        }

        if psutil:
            snap["cpu_percent"] = psutil.cpu_percent(interval=0.1)
            mem = psutil.virtual_memory()
            snap["mem_total_gb"] = round(mem.total / 1e9, 1)
            snap["mem_used_gb"] = round(mem.used / 1e9, 1)
            snap["mem_percent"] = mem.percent
            disk = psutil.disk_usage(str(self.cwd))
            snap["disk_free_gb"] = round(disk.free / 1e9, 1)
            snap["disk_total_gb"] = round(disk.total / 1e9, 1)

        # List files in cwd (up to 30)
        try:
            entries = sorted(self.cwd.iterdir(), key=lambda p: (p.is_file(), p.name))
            snap["cwd_contents"] = [
                ("d " if e.is_dir() else "f ") + e.name
                for e in entries[:30]
            ]
        except Exception:
            snap["cwd_contents"] = []

        return snap

    def get_context_string(self) -> str:
        """Compact string representation of system state for the AI system prompt."""
        snap = self.get_system_snapshot()
        lines = [
            f"User: {snap['user']}@{snap['hostname']}",
            f"OS: {snap['os']}",
            f"CWD: {snap['cwd']}",
            f"CWD contents: {', '.join(snap['cwd_contents'][:15]) or '(empty)'}",
        ]
        if "mem_percent" in snap:
            lines.append(
                f"Memory: {snap['mem_used_gb']}GB / {snap['mem_total_gb']}GB ({snap['mem_percent']}%)"
            )
        if "cpu_percent" in snap:
            lines.append(f"CPU: {snap['cpu_percent']}%")
        if "disk_free_gb" in snap:
            lines.append(f"Disk free: {snap['disk_free_gb']}GB / {snap['disk_total_gb']}GB")
        lines.append(f"Time: {snap['timestamp']}")
        return "\n".join(lines)
