"""
ai_brain.py — the AI layer: intent parsing, tool use, conversation memory
"""

import json
import re
from typing import Optional

import anthropic


SYSTEM_PROMPT = """You are AIShell, an AI-native interactive shell running on Ubuntu Linux.
You replace the traditional bash prompt. Your job is to understand what the user wants and
either execute shell commands to do it, or answer questions directly.

CURRENT SYSTEM STATE:
{system_context}

You have one tool available: run_command.
Use it to execute shell commands on behalf of the user.

BEHAVIOR RULES:
1. For clear action requests ("list files", "create a folder called x", "show running processes",
   "install git", "find all .py files"), call run_command immediately — don't ask for confirmation
   unless the command is destructive (rm, sudo, overwriting files).
2. For destructive or irreversible operations (deleting files, sudo commands that modify system),
   describe what you're about to do and ask "shall I proceed?".
3. For questions ("what does top do?", "explain this error", "what's using port 8080?"),
   answer directly. Call run_command first to gather facts if needed.
4. For ambiguous input, make a reasonable interpretation and state it briefly.
5. After running commands, interpret the output in plain English — don't just repeat raw output.
   Highlight important findings (errors, warnings, notable results).
6. You are a shell — be concise. No lengthy preambles. Get to the point.
7. When a command produces an error, explain what went wrong and suggest a fix.
8. You can chain multiple commands by calling run_command multiple times.

FORMAT:
- Keep prose responses SHORT (2-4 sentences max for simple things).
- Use plain text. No markdown headers or bullet lists unless the user asked for structured output.
- When showing file contents or command output, keep it focused on what's relevant.
"""

TOOLS = [
    {
        "name": "run_command",
        "description": (
            "Execute a shell command on the user's Ubuntu system. "
            "Use this for any file operations, process management, package installation, "
            "git operations, system inspection, or any other task that requires running commands. "
            "The working directory persists across calls within a session."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "command": {
                    "type": "string",
                    "description": "The shell command to execute. Can use pipes, redirects, etc.",
                },
                "explanation": {
                    "type": "string",
                    "description": "One-line explanation of what this command does (shown to user).",
                },
            },
            "required": ["command"],
        },
    }
]


class AIBrain:
    def __init__(self, api_key: str, shell_core, broadcaster=None):
        self.client = anthropic.Anthropic(api_key=api_key)
        self.core = shell_core
        self.broadcaster = broadcaster
        self.conversation: list[dict] = []
        self.max_history = 20  # keep last N message pairs

    def _emit(self, event: dict):
        if self.broadcaster:
            self.broadcaster.emit(event)

    def reset(self):
        self.conversation = []

    def print_conversation_history(self):
        if not self.conversation:
            print("  (no history yet)")
            return
        for i, msg in enumerate(self.conversation):
            role = msg["role"].upper()
            content = msg["content"]
            if isinstance(content, str):
                preview = content[:120].replace("\n", " ")
            elif isinstance(content, list):
                preview = str(content[0])[:120]
            else:
                preview = str(content)[:120]
            print(f"  [{i:02d}] {role}: {preview}")

    def handle(self, user_input: str, renderer):
        """Main entry: send user input to Claude, handle tool calls, stream response."""
        self.conversation.append({"role": "user", "content": user_input})
        self._trim_history()

        system = SYSTEM_PROMPT.format(system_context=self.core.get_context_string())

        self._emit({"type": "ai_thinking", "input": user_input})

        # Agentic loop: keep going until no more tool calls
        max_rounds = 8
        for round_num in range(max_rounds):
            try:
                response = self.client.messages.create(
                    model="claude-sonnet-4-20250514",
                    max_tokens=2048,
                    system=system,
                    tools=TOOLS,
                    messages=self.conversation,
                )
            except anthropic.APIError as e:
                renderer.print_error(f"API error: {e}")
                self._emit({"type": "ai_response", "text": f"API error: {e}"})
                self.conversation.pop()  # remove the failed user message
                return

            # Collect text and tool_use blocks
            text_blocks = []
            tool_calls = []
            for block in response.content:
                if block.type == "text":
                    text_blocks.append(block.text)
                elif block.type == "tool_use":
                    tool_calls.append(block)

            # Print any prose first
            if text_blocks:
                combined = " ".join(text_blocks)
                renderer.print_ai_response(combined)
                self._emit({"type": "ai_response", "text": combined})

            # If no tool calls, we're done
            if not tool_calls or response.stop_reason == "end_turn":
                # Record assistant turn
                self.conversation.append(
                    {"role": "assistant", "content": response.content}
                )
                break

            # Execute tool calls
            tool_results = []
            for tc in tool_calls:
                cmd = tc.input.get("command", "")
                explanation = tc.input.get("explanation", "")

                self._emit({"type": "tool_start", "command": cmd, "explanation": explanation})
                renderer.print_command(cmd, explanation)
                result = self.core.run_command(cmd)
                renderer.print_command_result(result)
                self._emit({
                    "type": "tool_result",
                    "command": cmd,
                    "exit_code": result["exit_code"],
                    "stdout": result["stdout"][:4000],
                })

                tool_results.append({
                    "type": "tool_result",
                    "tool_use_id": tc.id,
                    "content": json.dumps({
                        "stdout": result["stdout"][:4000],
                        "stderr": result["stderr"][:2000],
                        "exit_code": result["exit_code"],
                    }),
                })

            # Record assistant turn with tool calls, then tool results
            self.conversation.append(
                {"role": "assistant", "content": response.content}
            )
            self.conversation.append(
                {"role": "user", "content": tool_results}
            )

            # If stop reason is tool_use, loop again for follow-up
            if response.stop_reason != "tool_use":
                break
        else:
            renderer.print_error("Reached max tool call rounds.")

    def _trim_history(self):
        """Keep conversation from growing unbounded."""
        if len(self.conversation) > self.max_history * 2:
            # Keep first message for context, trim the middle
            self.conversation = self.conversation[-(self.max_history * 2):]
