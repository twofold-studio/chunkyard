#!/usr/bin/env python3
"""Opt-in smoke test against a real CLI daemon and the live Adoptium provider.

Run after `cargo build -p mcm-server`: python3 scripts/smoke-backend.py
Uses temporary credentials/storage; no secrets are printed. Downloads one JRE.
"""
import http.cookiejar
import json
import os
from pathlib import Path
import secrets
import signal
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request


def main():
    binary = Path("target/debug/mcm.exe" if os.name == "nt" else "target/debug/mcm").resolve()
    with tempfile.TemporaryDirectory(prefix="mcm-backend-smoke-") as directory:
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            port = listener.getsockname()[1]
        base = f"http://127.0.0.1:{port}"
        jar = http.cookiejar.CookieJar()
        client = urllib.request.build_opener(urllib.request.ProxyHandler({}), urllib.request.HTTPCookieProcessor(jar))
        with tempfile.TemporaryFile() as log:
            process = subprocess.Popen([str(binary), "--data-dir", directory, "serve", "--listen", f"127.0.0.1:{port}"], stdout=log, stderr=log)
            try:
                def request(path, body=None):
                    data = None if body is None else json.dumps(body).encode()
                    headers = {"Origin": base, "X-MCM-CSRF": "1", "Content-Type": "application/json"}
                    with client.open(urllib.request.Request(base + path, data=data, headers=headers), timeout=30) as response:
                        return json.load(response)

                for _ in range(200):
                    if process.poll() is not None:
                        raise RuntimeError("daemon exited before becoming ready")
                    try:
                        if request("/healthz")["status"] == "ok":
                            break
                    except (OSError, urllib.error.URLError):
                        time.sleep(0.05)
                else:
                    raise RuntimeError("daemon did not become ready")
                token = Path(directory, "setup-token").read_text()
                password = secrets.token_urlsafe(32)
                owner = request("/api/v1/setup", {"setupToken": token, "email": "smoke@example.com", "password": password})
                assert owner["user"]["role"] == "owner"
                releases = request("/api/v1/java/available")
                assert 21 in releases["all"]
                job = request("/api/v1/java/runtimes/install", {"major": 21})["job"]
                deadline = time.monotonic() + 180
                while time.monotonic() < deadline:
                    result = request("/api/v1/jobs/" + job["id"])
                    if result["state"] == "succeeded":
                        break
                    if result["state"] == "failed":
                        raise RuntimeError("Java job failed: " + result["error"]["code"])
                    time.sleep(0.2)
                else:
                    raise RuntimeError("Java install did not complete")
                runtime = result["result"]["runtime"]
                assert runtime["major"] == 21 and runtime["managed"]
                inventory = request("/api/v1/java/runtimes")["items"]
                assert any(item["id"] == runtime["id"] for item in inventory)
                print("PASS: real daemon setup, session, live catalog, Java 21 install job, and inventory")
            finally:
                if process.poll() is None:
                    if os.name == "nt":
                        process.terminate()
                    else:
                        process.send_signal(signal.SIGTERM)
                    try:
                        process.wait(timeout=15)
                    except subprocess.TimeoutExpired:
                        process.kill()
                        process.wait()


if __name__ == "__main__":
    main()
