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


def main():
    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key:
        print("\n[aishell] ANTHROPIC_API_KEY not set.")
        print("Export it: export ANTHROPIC_API_KEY=sk-...\n")
        sys.exit(1)

    broadcaster = WSBroadcaster()
    broadcaster.start()

    renderer = Renderer()
    renderer.print_banner()

    core = ShellCore()
    brain = AIBrain(api_key=api_key, shell_core=core, broadcaster=broadcaster)

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

        # Everything else goes to the AI
        brain.handle(user_input, renderer)


if __name__ == "__main__":
    main()
