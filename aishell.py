#!/usr/bin/env python3
"""
AIShell — an AI-native interactive shell for Ubuntu.
Run: python3 aishell.py
Requires: pip install anthropic prompt_toolkit psutil
"""

import os
import sys
import subprocess
import json
import shutil
import platform
import socket
from datetime import datetime
from pathlib import Path

try:
    import anthropic
    from prompt_toolkit import PromptSession
    from prompt_toolkit.history import FileHistory
    from prompt_toolkit.auto_suggest import AutoSuggestFromHistory

    import psutil
except ImportError as e:
    print(f"\n[aishell] Missing dependency: {e}")
    print("Run: pip install anthropic prompt_toolkit psutil\n")
    sys.exit(1)

from shell_core import ShellCore
from ai_brain import AIBrain
from renderer import Renderer
from ws_server import WSBroadcaster
from mcp_manager import MCPManager
import command_store


def _handle_mcp(user_input: str, mcp: "MCPManager", renderer: "Renderer"):
    parts = user_input.split()
    sub = parts[1].lower() if len(parts) > 1 else "list"

    if sub == "list":
        renderer.print_mcp_servers(mcp.list_servers())

    elif sub == "add":
        if len(parts) < 4:
            renderer.print_error(
                "Usage:\n"
                "  mcp add stdio <name> <command> [args…]\n"
                "  mcp add sse   <name> <url>"
            )
            return
        transport = parts[2].lower()
        name      = parts[3]
        if transport == "stdio":
            if len(parts) < 5:
                renderer.print_error("Usage: mcp add stdio <name> <command> [args…]")
                return
            server = {"transport": "stdio", "command": parts[4], "args": parts[5:]}
        elif transport == "sse":
            if len(parts) < 5:
                renderer.print_error("Usage: mcp add sse <name> <url>")
                return
            server = {"transport": "sse", "url": parts[4]}
        else:
            renderer.print_error(f"Unknown transport '{transport}'. Use 'stdio' or 'sse'.")
            return
        mcp.add_server(name, server)
        renderer.print_info(f"Added MCP server '{name}'. Connecting…")
        mcp.connect(name)

    elif sub == "remove":
        if len(parts) < 3:
            renderer.print_error("Usage: mcp remove <name>")
            return
        name = parts[2]
        if mcp.remove_server(name):
            renderer.print_info(f"Removed MCP server '{name}'.")
        else:
            renderer.print_error(f"No MCP server named '{name}'.")

    elif sub == "connect":
        if len(parts) < 3:
            renderer.print_error("Usage: mcp connect <name>")
            return
        name = parts[2]
        if mcp.connect(name):
            renderer.print_info(f"Connecting to '{name}'…")
        else:
            renderer.print_error(f"No MCP server named '{name}' configured.")

    elif sub == "disconnect":
        if len(parts) < 3:
            renderer.print_error("Usage: mcp disconnect <name>")
            return
        mcp.disconnect(parts[2])
        renderer.print_info(f"Disconnected '{parts[2]}'.")

    else:
        renderer.print_error(
            "Unknown mcp sub-command. Available: list, add, remove, connect, disconnect"
        )


def _offer_save(commands: list[str], renderer):
    """After an AI response that ran commands, offer to save them as a named command."""
    TEAL  = "\033[38;2;93;202;165m"
    GRAY  = "\033[38;2;136;135;128m"
    AMBER = "\033[38;2;250;199;117m"
    R     = "\033[0m"
    try:
        name = input(
            f"\n  {TEAL}◆{R} {GRAY}Save as command?{R} "
            f"{AMBER}Enter a name{R} {GRAY}(or press Enter to skip):{R} "
        ).strip()
    except EOFError:
        return
    if not name:
        return
    if not name.isidentifier():
        print(f"  {AMBER}Name must be a single word (letters, digits, underscores).{R}\n")
        return
    command_store.save_command(name, commands)
    renderer.print_info(f"Saved as ':{name}'. Run it anytime with  :{name}")


def main():
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("\n[aishell] ANTHROPIC_API_KEY not set.")
        print("Export it: export ANTHROPIC_API_KEY=sk-...\n")
        sys.exit(1)

    broadcaster = WSBroadcaster()
    broadcaster.start()

    mcp = MCPManager(broadcaster=broadcaster)
    mcp.start()

    renderer = Renderer()
    renderer.print_banner()

    core = ShellCore()
    brain = AIBrain(api_key=api_key, shell_core=core, broadcaster=broadcaster, mcp_manager=mcp)

    history_file = Path.home() / ".aishell_history"
    session = PromptSession(
        history=FileHistory(str(history_file)),
        auto_suggest=AutoSuggestFromHistory(),
    )

    while True:
        try:
            prompt_text = core.build_prompt()
            user_input = session.prompt(prompt_text).strip()
        except KeyboardInterrupt:
            print()
            continue
        except EOFError:
            renderer.print_goodbye()
            break

        if not user_input:
            continue

        # Built-in passthrough commands
        if user_input.lower() in ("exit", "quit", "bye"):
            renderer.print_goodbye()
            break

        if user_input.lower() == "clear":
            os.system("clear")
            renderer.print_banner()
            continue

        if user_input.lower() in ("history", "!history"):
            brain.print_conversation_history()
            continue

        if user_input.lower() in ("reset", "!reset"):
            brain.reset()
            renderer.print_info("Conversation reset.")
            continue

        if user_input.lower() in ("sysinfo", "!sysinfo"):
            renderer.print_sysinfo(core.get_system_snapshot())
            continue

        if user_input.lower().startswith("mcp"):
            _handle_mcp(user_input, mcp, renderer)
            continue

        if user_input.lower() in ("commands", "!commands"):
            renderer.print_saved_commands(command_store.list_commands())
            continue

        if user_input.lower().startswith("forget "):
            name = user_input.split(None, 1)[1].strip()
            if command_store.delete_command(name):
                renderer.print_info(f"Deleted command '{name}'.")
            else:
                renderer.print_error(f"No saved command named '{name}'.")
            continue

        # Run a saved command by name  (:name)
        if user_input.startswith(":"):
            name = user_input[1:].strip()
            saved = command_store.get_command(name)
            if not saved:
                renderer.print_error(f"No saved command named '{name}'. Type 'commands' to list them.")
                continue
            renderer.print_info(f"Running '{name}'…")
            for cmd in saved["commands"]:
                result = core.run_command(cmd)
                renderer.print_direct_output(result)
                if result["exit_code"] != 0 and result.get("stderr", "").strip():
                    brain.suggest_fix(cmd, result, renderer)
            continue

        # AI prompt — user prefixed with "#"
        if user_input.startswith("#"):
            ai_input = user_input[1:].strip()
            if ai_input:
                executed = brain.handle(ai_input, renderer)
                if executed:
                    _offer_save(executed, renderer)
            continue

        # Direct command execution
        result = core.run_command(user_input)
        renderer.print_direct_output(result)

        # AI error monitoring — suggest a fix if the command failed
        if result["exit_code"] != 0 and result.get("stderr", "").strip():
            brain.suggest_fix(user_input, result, renderer)


if __name__ == "__main__":
    main()
