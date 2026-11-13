#!/usr/bin/env python3
"""Linux-only smoke test for a Dockerized manager controlling a sibling JVM.
Requires mcm-manager:local, mcm-manager-java-test-runtime:local and the JAR
produced by `bash scripts/smoke-docker.sh --java`. Cleans up its containers.
"""
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import uuid


def docker(*args):
    return subprocess.check_output(["docker", *args], stderr=subprocess.STDOUT).decode().strip()


def main():
    fixture = Path("target/docker-fixture/server.jar").resolve()
    if not fixture.is_file():
        raise RuntimeError("run bash scripts/smoke-docker.sh --java first")
    name = "mcm-packaging-smoke-" + uuid.uuid4().hex
    server_name = None
    with tempfile.TemporaryDirectory(prefix="mcm-container-smoke-") as directory:
        with socket.socket() as listener:
            listener.bind(("127.0.0.1", 0))
            port = listener.getsockname()[1]
        base = f"http://127.0.0.1:{port}"
        client = urllib.request.build_opener(urllib.request.ProxyHandler({}))

        def request(path, body=None):
            data = None if body is None else json.dumps(body).encode()
            headers = {"Origin": base, "X-MCM-CSRF": "1", "Content-Type": "application/json"}
            with client.open(urllib.request.Request(base + path, data=data, headers=headers), timeout=15) as response:
                return json.load(response)

        def ready():
            for _ in range(200):
                try:
                    if request("/healthz")["status"] == "ok":
                        return
                except (OSError, urllib.error.URLError):
                    time.sleep(0.05)
            raise RuntimeError("containerized manager did not become ready")

        def action(server_id, verb):
            job_id = request(f"/api/v1/servers/{server_id}/{verb}", {})["job"]["id"]
            for _ in range(200):
                job = request("/api/v1/jobs/" + job_id)
                if job["state"] == "succeeded":
                    return job["result"]["server"]
                if job["state"] == "failed":
                    raise RuntimeError("server job failed: " + job["error"]["code"])
                time.sleep(0.05)
            raise RuntimeError("server job did not finish")

        try:
            docker("run", "-d", "--name", name, "--user", f"{os.getuid()}:{os.getgid()}",
                   "--group-add", str(os.stat("/var/run/docker.sock").st_gid),
                   "-p", f"127.0.0.1:{port}:8420", "-v", f"{directory}:/data",
                   "-v", "/var/run/docker.sock:/var/run/docker.sock",
                   "-e", "MCM_AUTH__ENABLED=false", "-e", f"MCM_HTTP__PUBLIC_URL={base}",
                   "-e", "MCM_HTTP__ALLOW_INSECURE_HTTP=true",
                   "-e", f"MCM_DOCKER__HOST_DATA_DIR={directory}", "mcm-manager:local")
            ready()
            assert request("/api/v1/system/isolation")["docker"]["available"]
            with socket.socket() as listener:
                listener.bind(("127.0.0.1", 0))
                game_port = listener.getsockname()[1]
            server = request("/api/v1/servers", {"name": "Packaging fixture", "port": game_port,
                             "dockerImage": "mcm-manager-java-test-runtime:local",
                             "memoryMinMb": 128, "memoryMaxMb": 256})["server"]
            server_id = server["id"]
            accepted = request(f"/api/v1/servers/{server_id}/eula", {"accepted": True})
            assert accepted["server"]["acceptEula"]
            server_name = "mcm-" + Path(directory, "instance-id").read_text() + "-" + server_id
            docker("cp", str(fixture), f"{name}:/data/servers/{server_id}/server.jar")
            assert action(server_id, "start")["status"]["state"] == "running"
            docker("stop", "--time", "15", name)
            assert docker("inspect", "--format", "{{.State.Running}}", server_name) == "true"
            docker("start", name)
            ready()
            assert request("/api/v1/servers/" + server_id)["status"]["state"] == "running"
            assert action(server_id, "stop")["status"]["state"] == "stopped"
            print("PASS: non-root Dockerized manager, socket access, sibling JVM bind mount, restart adoption, and graceful stop")
        finally:
            for container in [server_name, name]:
                if container:
                    subprocess.run(["docker", "rm", "--force", container], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)


if __name__ == "__main__":
    main()
