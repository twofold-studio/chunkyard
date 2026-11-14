# CurseForge server packs

This phase adds server-pack installation using CurseForge's authenticated metadata and the publisher's linked server archive. Set `CHUNKYARD_CURSEFORGE__API_KEY` on the manager; the key is excluded from config inspection and never reaches the browser or game container. [CurseForge documents the third-party API and key application here](https://docs.curseforge.com/rest-api/).

Pick a pack and client release; Chunkyard resolves the matching server file, verifies its published SHA-1, extracts it into private staging and records the ZIP's SHA-256. Server archives can be up to 2 GiB compressed and 8 GiB extracted, with at most 100,000 entries. File selection lists up to the latest 200 published file records, retaining releases linked to server packs. A missing or author-disabled download is an error, not permission to construct a bypass URL.

Loader detection reads literal settings and manifests, installer filenames and prepared argument files. It never evaluates shell or PowerShell to discover a version. When the server archive omits the loader, the client manifest supplies its pinned version; client-only mods from that manifest are not added to the server pack. A single outer wrapper directory is flattened.

Forge, NeoForge and Fabric installers run in temporary Docker containers with only that instance's staging directory mounted. They have CPU/memory limits, a read-only root filesystem and no Docker socket or API key. Installer output is checked again for links and size before publication. Existing files are not overwritten; a collision requires moving the conflicting files before retrying. Installation does not run Minecraft, change EULA acceptance or delete worlds. Publisher properties are combined with independently saved owner settings, with the owner values taking precedence.

Under Settings → Launch, the owner can override the Java major, relative launch path, extra JVM/game arguments and image, or reset detection. Java `-jar`, Java argument files and Bash scripts are separate modes. Arguments are separate values; the manager does not interpret shell command text. A Bash script runs inside the game container and may need tools absent from the default Temurin image. Windows batch files do not run on this Linux backend. A custom script controls its JVM options; Docker still enforces the configured resource limits. Advanced install overrides can select a different loader/version or an explicit prepared launch file for unusual packs.

Restarts and retries retain the same instance. Jobs interrupted by a manager shutdown fail rather than report a completed install. Cancellation retains the instance lock while blocking extraction or installer cleanup finishes. Startup removes owned installer containers left by a killed manager. Once installation metadata persistence begins, published files are retained even if the acknowledgement is lost. A crash or persistence failure during final publication can leave conflicting files; move them before retrying instead of overwriting potential user data.

## Archive survey

On 2026-11-14, the survey took 20 results from the Minecraft modpack API search with `sortField=6` (total downloads), fetched current file metadata and inspected server ZIP directories and small bootstrap/configuration files using HTTP ranges. These are observed formats, not promises that every release of a project works. No publisher scripts were executed during the survey. Full download and loader-install tests are separate checks.

| Pack | Sample Minecraft | Observed server archive |
| --- | --- | --- |
| RLCraft | 1.12.2 | Mods/configs, no loader JAR; resolve Forge from the client manifest. |
| All the Mods 10 | 1.21.1 | Bundled NeoForge installer; version pinned in `startserver.sh`. |
| Pixelmon | 1.21.1 | NeoForge version in `variables.txt` and a custom manifest schema. |
| Better MC Forge BMC4 | 1.20.1 | Variables-driven Forge bootstrap. |
| All the Mods 9 | 1.20.1 | Wrapper folder, Forge installer and JVM arguments file. |
| Prominence II | 1.20.1 | Fabric version and Java recommendation in `variables.txt`. |
| SkyFactory 4 | 1.12.2 | Forge installer and `settings.sh`/`Install.sh`. |
| DawnCraft | 1.18.2 | Variables-driven Forge bootstrap; metadata also lists other version labels. |
| All the Mods 8 | 1.19.2 | Wrapper folder and Forge download/install script. |
| DeceasedCraft | 1.20.1 | Forge installer, Windows launcher and JVM arguments file. |
| Cursed Walking | 1.20.1 | Wrapper folder, `server.jar` and Windows launcher. |
| Fabulously Optimized | 1.20.6 | Sample artifact is a MultiMC/client export, with `mmc-pack.json`; rejected as an automatically installable server. |
| Better MC Fabric BMC1 | 1.19.2 | Fabric bootstrap settings. |
| Roguelike Adventures and Dungeons | 1.12.2 | Wrapper folder and mods/configs without a ready loader. |
| SevTech Ages | 1.12.2 | Forge installer pinned in `settings.sh`. |
| FTB SkyFactory 3 | 1.10.2 | Legacy Forge installer and startup/settings scripts. |
| All the Mods 6 | 1.16.5 | Forge download/install/start script. |
| Cave Horror Project 1 | 1.20.1 | Prepared Forge libraries and `unix_args.txt`; no reinstall required when present. |
| Vault Hunters 3 | 1.18.2 | CurseForge manifest plus a setup script pinning Forge. |
| Better MC Forge BMC1 | 1.16.5 | Variables-driven Forge bootstrap; recommends Java 11. |

Evidence comes from the authors' linked server archives returned by the [CurseForge file API](https://docs.curseforge.com/rest-api/#get-mod-file), including RLCraft `4612990`, ATM10 `9431427`, Pixelmon `7454494` and Prominence `9563792`. These are observations, not installer rules. The implementation uses current metadata and content detection rather than pack-name exceptions. [AllTheMods' maintained startup scripts](https://github.com/AllTheMods/Server-Scripts) also document the separation between installation and launch.

There is no universal launcher for all archives. Client-only packs may need no modded server at all, and a publisher can change format or Java requirements. Prefer a linked server pack; use explicit overrides when detection needs help. A successful loader-install check is not a claim that all mods have booted or that gameplay has been tested.
