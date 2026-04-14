#!/usr/bin/env python3
"""
Live log sink for adblocky extension.

Starts an HTTP server on http://localhost:9999 that accepts POST /adb-log
with a JSON body { ts, level, module, msg, data?, url? }. Appends each
entry to logs/adblocky.log (JSONL, one entry per line) AND tails to stdout
with color.

Usage:
    python3 scripts/log-sink.py            # default port 9999
    python3 scripts/log-sink.py --port 8888

Run from the project root. Log file path: ./logs/adblocky.log
Ctrl+C to stop.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

LOG_DIR = "logs"
LOG_FILE = os.path.join(LOG_DIR, "adblocky.log")

# ANSI colors
C_RESET = "\033[0m"
C_DIM = "\033[2m"
C_RED = "\033[31m"
C_YELLOW = "\033[33m"
C_GREEN = "\033[32m"
C_CYAN = "\033[36m"
C_MAGENTA = "\033[35m"
C_BLUE = "\033[34m"
C_GRAY = "\033[90m"

LEVEL_COLOR = {
    "error": C_RED,
    "block": C_RED,
    "warn": C_YELLOW,
    "info": C_CYAN,
}

MODULE_COLOR = {
    "youtube": C_RED,
    "yt-main": C_MAGENTA,
    "yt-diag": C_BLUE,
    "cosmetic": C_BLUE,
    "background": C_GRAY,
    "settings": C_GREEN,
    "anti-adblock": C_YELLOW,
    "popup-blocker": C_YELLOW,
}


def color_module(mod: str) -> str:
    return f"{MODULE_COLOR.get(mod, C_GREEN)}{mod}{C_RESET}"


def color_level(lvl: str) -> str:
    return f"{LEVEL_COLOR.get(lvl, C_DIM)}{lvl.upper():5s}{C_RESET}"


def format_entry(entry: dict) -> str:
    ts = entry.get("ts")
    try:
        t = datetime.fromtimestamp(ts / 1000).strftime("%H:%M:%S.%f")[:-3]
    except Exception:
        t = "??:??:??.???"
    level = entry.get("level", "info")
    module = entry.get("module", "?")
    msg = entry.get("msg", "")
    data = entry.get("data")
    url = entry.get("url")
    line = f"{C_DIM}{t}{C_RESET} {color_level(level)} {color_module(module):30s} {msg}"
    if url:
        line += f"\n  {C_GRAY}url:{C_RESET} {url}"
    if data is not None:
        try:
            compact = json.dumps(data, separators=(",", ":"))
            if len(compact) > 400:
                compact = compact[:400] + "…"
            line += f"\n  {C_GRAY}data:{C_RESET} {compact}"
        except Exception:
            line += f"\n  {C_GRAY}data:{C_RESET} {data!r}"
    return line


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a, **kw):
        # Silence default "GET / HTTP/1.1 200" access log
        return

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.end_headers()

    def do_GET(self):
        # Simple health + recent-tail page
        if self.path in ("/", "/health"):
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "text/plain; charset=utf-8")
            self.end_headers()
            self.wfile.write(b"adb log-sink OK\n")
            return
        if self.path == "/tail":
            self.send_response(200)
            self._cors()
            self.send_header("Content-Type", "application/x-ndjson")
            self.end_headers()
            if os.path.exists(LOG_FILE):
                with open(LOG_FILE, "rb") as f:
                    try:
                        f.seek(-65536, os.SEEK_END)
                    except OSError:
                        f.seek(0)
                    self.wfile.write(f.read())
            return
        self.send_response(404)
        self._cors()
        self.end_headers()

    def do_POST(self):
        if self.path != "/adb-log":
            self.send_response(404)
            self._cors()
            self.end_headers()
            return

        length = int(self.headers.get("Content-Length", "0") or 0)
        raw = self.rfile.read(length) if length else b""
        try:
            body = json.loads(raw.decode("utf-8"))
        except Exception as e:
            self.send_response(400)
            self._cors()
            self.end_headers()
            self.wfile.write(f"bad json: {e}".encode())
            return

        # Accept a single entry or a batch
        entries = body if isinstance(body, list) else [body]
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            for entry in entries:
                if not isinstance(entry, dict):
                    continue
                f.write(json.dumps(entry, separators=(",", ":")) + "\n")
                try:
                    print(format_entry(entry), flush=True)
                except Exception as e:
                    print(f"[sink] format error: {e}", file=sys.stderr, flush=True)

        self.send_response(204)
        self._cors()
        self.end_headers()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=9999)
    ap.add_argument("--host", default="127.0.0.1")
    args = ap.parse_args()

    os.makedirs(LOG_DIR, exist_ok=True)
    # Rotate marker per run
    with open(LOG_FILE, "a", encoding="utf-8") as f:
        marker = {
            "ts": int(datetime.now().timestamp() * 1000),
            "level": "info",
            "module": "sink",
            "msg": f"--- log sink started (pid={os.getpid()}) ---",
        }
        f.write(json.dumps(marker) + "\n")

    srv = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"{C_GREEN}[adb log-sink]{C_RESET} listening on http://{args.host}:{args.port}")
    print(f"{C_GREEN}[adb log-sink]{C_RESET} appending to {LOG_FILE}")
    print(f"{C_DIM}Ctrl+C to stop.{C_RESET}\n")
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print(f"\n{C_YELLOW}[adb log-sink]{C_RESET} stopped")


if __name__ == "__main__":
    main()
