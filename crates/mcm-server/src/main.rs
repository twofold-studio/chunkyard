//! Composition root and local administration CLI. The frontend is implemented separately.
use anyhow::{Context, Result};
use clap::{Parser, Subcommand};
use mcm_config::Config;
use mcm_core::java::{JavaRequirement, JavaRuntimeRepo};
use mcm_db::SqliteJavaRuntimeRepo;
use mcm_download::SafeHttp;
use mcm_java::{Adoptium, AdoptiumApi, DiscoveryPaths, JavaManager};
use std::{path::PathBuf, sync::Arc};

#[derive(Parser)]
#[command(name = "mcm", version, about = "Minecraft server manager backend")]
struct Cli {
    #[arg(long, global = true)]
    data_dir: Option<PathBuf>,
    #[arg(long, env = "MCM_CONFIG", global = true)]
    config: Option<PathBuf>,
    #[command(subcommand)]
    command: Option<Command>,
}
#[derive(Subcommand)]
enum Command {
    /// Serve the authenticated HTTP API (frontend is developed separately).
    Serve {
        #[arg(long)]
        listen: Option<std::net::SocketAddr>,
    },
    /// Validate file/environment configuration and print the effective settings.
    Config {
        #[command(subcommand)]
        command: ConfigCommand,
    },
    /// Discover, download, inspect, and select per-server Java runtimes.
    Java {
        #[command(subcommand)]
        command: JavaCommand,
    },
    /// Apply database migrations and exit.
    Migrate,
}
#[derive(Subcommand)]
enum ConfigCommand {
    Check,
}
#[derive(Subcommand)]
enum JavaCommand {
    /// Scan JAVA_HOME, PATH, and common Linux/Windows installation directories.
    Discover,
    /// Show persisted system and managed runtimes.
    List,
    /// Show versions currently offered by Adoptium for download.
    Releases,
    /// Install the latest available Temurin JRE for a major (e.g. 8, 17, 21, 25).
    Install { major: u16 },
    /// Select an existing runtime; prints its stable ID and executable path.
    Select {
        major: u16,
        #[arg(long)]
        strict: bool,
    },
    /// Inspect an explicit executable without adding it to the inventory.
    Inspect { path: PathBuf },
}

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .with_writer(std::io::stderr)
        .init();
    let cli = Cli::parse();
    let command = cli.command.unwrap_or(Command::Serve { listen: None });
    let mut config = Config::load(cli.config.as_deref())?;
    if let Some(data_dir) = &cli.data_dir {
        config.data_dir = data_dir.clone();
    }
    if let Command::Serve {
        listen: Some(listen),
    } = &command
    {
        config.http.listen = *listen;
    }
    config.validate()?;
    match &command {
        Command::Config {
            command: ConfigCommand::Check,
        } => return print_json(&config),
        Command::Serve { .. } => {
            let listener = tokio::net::TcpListener::bind(config.http.listen).await?;
            config.http.listen = listener.local_addr()?;
            let backend = mcm_server::wiring::build_state(&config).await?;
            tracing::info!(listen = %listener.local_addr()?, "backend listening");
            let result = axum::serve(
                listener,
                mcm_api::router(backend.state.clone())
                    .into_make_service_with_connect_info::<std::net::SocketAddr>(),
            )
            .with_graceful_shutdown(shutdown_signal())
            .await;
            backend.shutdown().await;
            return result.context("HTTP server failed");
        }
        _ => (),
    }
    // Read-only upstream/explicit probes do not create a database or data directory.
    let http = SafeHttp::adoptium()?;
    let upstream = Arc::new(Adoptium::new(http.clone()));
    match &command {
        Command::Java {
            command: JavaCommand::Releases,
        } => return print_json(&upstream.releases().await?),
        Command::Java {
            command: JavaCommand::Inspect { path },
        } => return print_json(&mcm_java::identify(path).await?),
        _ => (),
    }
    tokio::fs::create_dir_all(&config.data_dir)
        .await
        .context("create data directory")?;
    let repo = Arc::new(SqliteJavaRuntimeRepo::open(&config.data_dir.join("mcm.db")).await?);
    let manager = JavaManager::new(
        config.data_dir.join("runtimes/java"),
        repo.clone(),
        upstream,
        http,
    );
    match command {
        Command::Migrate
        | Command::Serve { .. }
        | Command::Config {
            command: ConfigCommand::Check,
        } => (),
        Command::Java { command } => match command {
            JavaCommand::Discover => {
                anyhow::ensure!(
                    config.java.allow_system_java,
                    "system Java discovery is disabled by configuration"
                );
                print_json(&manager.discover(DiscoveryPaths::system()).await?)?
            }
            JavaCommand::List => {
                let mut runtimes = manager.list().await?;
                if !config.java.allow_system_java {
                    runtimes.retain(|runtime| runtime.managed);
                }
                print_json(&runtimes)?;
            }
            JavaCommand::Install { major } => print_json(&manager.install(major).await?)?,
            JavaCommand::Select { major, strict } => {
                let mut runtimes = repo.list().await?;
                if !config.java.allow_system_java {
                    runtimes.retain(|runtime| runtime.managed);
                }
                let runtime = mcm_java::select(&runtimes, JavaRequirement { major, strict })
                    .context(
                        "no compatible runtime installed; run java discover or java install",
                    )?;
                anyhow::ensure!(
                    runtime.path.is_file(),
                    "selected Java executable has vanished; rescan or reinstall it"
                );
                print_json(runtime)?;
            }
            JavaCommand::Releases | JavaCommand::Inspect { .. } => (),
        },
    }
    Ok(())
}

fn print_json(value: &impl serde::Serialize) -> Result<()> {
    use std::io::Write;
    let mut out = std::io::stdout().lock();
    serde_json::to_writer_pretty(&mut out, value)?;
    writeln!(out)?;
    Ok(())
}

async fn shutdown_signal() {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{SignalKind, signal};
        match signal(SignalKind::terminate()) {
            Ok(mut terminate) => {
                tokio::select! { _ = tokio::signal::ctrl_c() => (), _ = terminate.recv() => () }
            }
            Err(error) => {
                tracing::error!(%error, "could not register SIGTERM handler");
                let _ = tokio::signal::ctrl_c().await;
            }
        }
    }
    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
}
