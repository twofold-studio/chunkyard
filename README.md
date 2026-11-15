<p align="center">
  <img src="assets/logo.png" alt="Chunkyard logo" width="160" />
</p>

<p align="center">
  <a href="docs/frontend.md"><img src="https://img.shields.io/badge/docs-get_started-e87524" alt="Getting started" /></a>
  <a href="CHANGELOG.md"><img src="https://img.shields.io/badge/status-in_development-555555" alt="In development" /></a>
</p>

<h1 align="center">Chunkyard</h1>

<p align="center">
  <img src="assets/screenshots/hero.webp" alt="Chunkyard's server inventory and server creation form in its dark web interface" width="100%" />
</p>

<p align="center">Your Minecraft servers, in one yard.<br /><a href="https://chunkyard.fractal-tess.xyz">Open Chunkyard</a></p>

Chunkyard is a self-hosted Minecraft Java Edition server manager for one owner. A Rust service and Svelte web UI let you manage Docker server instances from one address, with persistent storage and no separate Node service to run.

- **Control** servers with start, stop, restart, and force kill. Stream the console, send commands, and watch CPU, memory and uptime with adjustable refresh intervals.
- **Run** each server with a compatible Java version supplied by its Docker image; no host Java installation is required.
- **Keep** a simple owner login, or disable authentication explicitly for a trusted local environment.

Choose Vanilla, Paper or a supported CurseForge server pack; Chunkyard downloads and verifies the files and selects a compatible Java image. Browse and edit files, or autosave versioned `server.properties` changes while the game runs and restart when ready to apply them. Export worlds or full instances to local storage or S3-compatible services such as RustFS. A verified full S3 backup lets you remove local files while keeping the server listed, then restore it when you want to play again. See the [backup and restore contract](docs/exports-contract.md) for limits.

This project is in active development. Custom JARs remain an advanced option. A running container does not establish Minecraft readiness.

## Run it

Build the image, including the web UI:

```sh
docker build -t chunkyard:local .
```

Follow the [Docker setup](docs/docker.md#run-the-manager-in-docker) to mount persistent storage and the Docker socket, then open `http://127.0.0.1:8420`. Authentication is enabled by default; the initial setup token is stored in the data directory.

For a source checkout, see [production UI hosting](docs/frontend.md#production-hosting) and [backend development](docs/backend.md). The executable is `mcm`; configuration uses `CHUNKYARD_*` environment variables.

## Documentation

[Web UI](docs/frontend.md) · [Docker runtime and deployment](docs/docker.md) · [REST API](docs/http-api.md) · [Monitoring](docs/monitoring.md) · [Oracle trial](docs/oracle-trial.md) · [Backend development](docs/backend.md) · [Contributing](CONTRIBUTING.md) · [Changelog](CHANGELOG.md)

The [phase specifications](specs/README.md) describe the broader roadmap. The usage guides document what is implemented today.
