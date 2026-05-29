"""
renderer.py — all terminal output: banner, AI responses, command display, errors
Uses ANSI escape codes; works on any modern terminal.
"""

import os
import socket
import platform
from datetime import datetime

try:
    import psutil
    _HAS_PSUTIL = True
except ImportError:
    _HAS_PSUTIL = False


# ── ANSI color palette ───────────────────────────────────────────────────────
R = "\033[0m"         # reset
BOLD = "\033[1m"
DIM = "\033[2m"

TEAL    = "\033[38;2;93;202;165m"    # #5DCAA5
PURPLE  = "\033[38;2;175;169;236m"   # #AFA9EC
AMBER   = "\033[38;2;250;199;117m"   # #FAC775
CORAL   = "\033[38;2;208;90;48m"     # #D05A30
GRAY    = "\033[38;2;136;135;128m"   # #888780
WHITE   = "\033[38;2;220;218;210m"   # near-white
RED     = "\033[38;2;226;75;74m"     # #E24B4A
GREEN   = "\033[38;2;99;153;34m"     # #639922
DIM_GRAY = "\033[38;2;95;94;90m"     # #5F5E5A

BG_DARK = "\033[48;2;30;30;28m"      # subtle bg for command blocks


class Renderer:

    def _cols(self) -> int:
        try:
            return os.get_terminal_size().columns
        except Exception:
            return 80

    def _hr(self, char="─", color=DIM_GRAY) -> str:
        return color + char * self._cols() + R

    # ── Banner ───────────────────────────────────────────────────────────────

    def print_banner(self):
        cols = self._cols()
        now = datetime.now().strftime("%Y-%m-%d %H:%M")
        user = os.environ.get("USER", "user")
        host = socket.gethostname()
        os_info = platform.platform(terse=True)

        lines = [
            "",
            f"{TEAL}{BOLD}" + "█████╗ ██╗    ███████╗██╗  ██╗███████╗██╗     ██╗" + R,
            f"{TEAL}{BOLD}" + "██╔══██╗██║    ██╔════╝██║  ██║██╔════╝██║     ██║" + R,
            f"{TEAL}{BOLD}" + "███████║██║    ███████╗███████║█████╗  ██║     ██║" + R,
            f"{TEAL}{BOLD}" + "██╔══██║██║    ╚════██║██╔══██║██╔══╝  ██║     ██║" + R,
            f"{TEAL}{BOLD}" + "██║  ██║██║    ███████║██║  ██║███████╗███████╗███████╗" + R,
            f"{TEAL}{BOLD}" + "╚═╝  ╚═╝╚═╝    ╚══════╝╚═╝  ╚═╝╚══════╝╚══════╝╚══════╝" + R,
            "",
            f"  {PURPLE}AI-native shell  {DIM_GRAY}·  {GRAY}{user}@{host}  {DIM_GRAY}·  {GRAY}{os_info}{R}",
            f"  {DIM_GRAY}{now}  {DIM_GRAY}·  type naturally or use shell commands{R}",
            "",
            f"  {DIM_GRAY}Built-ins: {GRAY}exit  clear  history  reset  sysinfo{R}",
            "",
            self._hr(),
            "",
        ]
        print("\n".join(lines))

    # ── AI response ──────────────────────────────────────────────────────────

    def print_ai_response(self, text: str):
        if not text.strip():
            return
        # Simple word-wrap at terminal width - 6 (indent)
        indent = "  "
        cols = self._cols() - len(indent) - 2
        words = text.split()
        lines = []
        current = []
        length = 0
        for word in words:
            if length + len(word) + 1 > cols and current:
                lines.append(" ".join(current))
                current = [word]
                length = len(word)
            else:
                current.append(word)
                length += len(word) + 1
        if current:
            lines.append(" ".join(current))

        print(f"\n{PURPLE}◆{R}")
        for line in lines:
            print(f"{indent}{WHITE}{line}{R}")
        print()

    # ── Command display ───────────────────────────────────────────────────────

    def print_command(self, command: str, explanation: str = ""):
        print(f"  {DIM_GRAY}┌─{R} {AMBER}{BOLD}$ {command}{R}")
        if explanation:
            print(f"  {DIM_GRAY}│  {DIM}{explanation}{R}")

    def print_command_result(self, result: dict):
        stdout = result.get("stdout", "").rstrip()
        stderr = result.get("stderr", "").rstrip()
        exit_code = result.get("exit_code", 0)

        if stdout:
            # Indent each line of output
            for line in stdout.splitlines()[:60]:  # cap at 60 lines
                print(f"  {DIM_GRAY}│{R}  {DIM}{line}{R}")
            if len(stdout.splitlines()) > 60:
                extra = len(stdout.splitlines()) - 60
                print(f"  {DIM_GRAY}│{R}  {DIM_GRAY}… {extra} more lines{R}")

        if stderr:
            for line in stderr.splitlines()[:20]:
                print(f"  {DIM_GRAY}│{R}  {RED}{line}{R}")

        status_color = GREEN if exit_code == 0 else RED
        status_sym = "✓" if exit_code == 0 else f"✗ exit {exit_code}"
        print(f"  {DIM_GRAY}└─{R} {status_color}{status_sym}{R}\n")

    # ── System info ──────────────────────────────────────────────────────────

    def print_sysinfo(self, snap: dict):
        print(f"\n  {TEAL}{BOLD}System snapshot{R}\n")
        fields = [
            ("User",    snap.get("user", "?") + "@" + snap.get("hostname", "?")),
            ("OS",      snap.get("os", "?")),
            ("CWD",     snap.get("cwd", "?")),
        ]
        if "mem_percent" in snap:
            fields.append(("Memory",
                f"{snap['mem_used_gb']}GB / {snap['mem_total_gb']}GB ({snap['mem_percent']}%)"))
        if "cpu_percent" in snap:
            fields.append(("CPU", f"{snap['cpu_percent']}%"))
        if "disk_free_gb" in snap:
            fields.append(("Disk free",
                f"{snap['disk_free_gb']}GB / {snap['disk_total_gb']}GB"))
        fields.append(("Time", snap.get("timestamp", "?")))
        if snap.get("cwd_contents"):
            fields.append(("Contents", "  ".join(snap["cwd_contents"][:10])))

        for label, value in fields:
            print(f"  {GRAY}{label:<12}{R} {WHITE}{value}{R}")
        print()

    # ── MCP servers ───────────────────────────────────────────────────────────

    def print_mcp_servers(self, servers: list):
        if not servers:
            print(f"\n  {GRAY}No MCP servers configured.{R}")
            print(f"  {DIM_GRAY}Add one: mcp add stdio <name> <command> [args]{R}\n")
            return
        print(f"\n  {TEAL}{BOLD}MCP Servers{R}\n")
        for s in servers:
            status = s.get("status", "disconnected")
            if status == "connected":
                dot = f"{GREEN}●{R}"
            elif status.startswith("error"):
                dot = f"{RED}●{R}"
            elif status == "connecting…":
                dot = f"{AMBER}●{R}"
            else:
                dot = f"{GRAY}●{R}"
            name = s.get("name", "?")
            transport = s.get("transport", "stdio")
            tools = s.get("tools", [])
            print(f"  {dot} {WHITE}{name:<20}{R} {DIM_GRAY}{transport}  {status}{R}")
            if tools:
                print(f"    {DIM_GRAY}tools: {', '.join(tools[:8])}{'…' if len(tools) > 8 else ''}{R}")
        print()

    # ── Saved commands ────────────────────────────────────────────────────────

    def print_saved_commands(self, commands: list):
        if not commands:
            print(f"\n  {GRAY}No saved commands yet.{R}")
            print(f"  {DIM_GRAY}Use  # <prompt>  to ask the AI, then save the result with a name.{R}\n")
            return
        print(f"\n  {TEAL}{BOLD}Saved commands{R}\n")
        for c in commands:
            name = c.get("name", "?")
            cmds = c.get("commands", [])
            created = c.get("created", "")[:10]
            print(f"  {TEAL}:{name:<20}{R} {DIM_GRAY}{created}{R}")
            for cmd in cmds:
                print(f"    {GRAY}$ {cmd}{R}")
        print()

    # ── Direct output ─────────────────────────────────────────────────────────

    def print_direct_output(self, result: dict):
        """Print raw command output exactly as a normal terminal would."""
        stdout = result.get("stdout", "").rstrip("\n")
        stderr = result.get("stderr", "").rstrip("\n")
        if stdout:
            print(stdout)
        if stderr:
            print(f"{RED}{stderr}{R}")

    # ── Utility ───────────────────────────────────────────────────────────────

    def print_error(self, msg: str):
        print(f"\n  {RED}✗ {msg}{R}\n")

    def print_info(self, msg: str):
        print(f"\n  {TEAL}· {msg}{R}\n")

    def print_goodbye(self):
        print(f"\n  {TEAL}Goodbye.{R}\n")
