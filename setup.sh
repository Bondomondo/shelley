#!/usr/bin/env bash
# setup.sh — install dependencies and launch AIShell
set -e

echo ""
echo "  Setting up AIShell..."
echo ""

# Check Python
if ! command -v python3 &>/dev/null; then
    echo "  Error: python3 not found. Install with: sudo apt install python3"
    exit 1
fi

# Check API key
if [ -z "$ANTHROPIC_API_KEY" ]; then
    echo "  ANTHROPIC_API_KEY is not set."
    echo ""
    echo "  Set it and re-run:"
    echo "    export ANTHROPIC_API_KEY=sk-ant-..."
    echo "    ./setup.sh"
    exit 1
fi

# Install deps
echo "  Installing Python dependencies..."
pip install -q -r requirements.txt

echo "  Done. Launching AIShell..."
echo ""

python3 aishell.py
