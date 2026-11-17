//! Composition root and local administration CLI. The frontend is implemented separately.
use anyhow::{Context, Result};
use chunkyard_config::Config;
use clap::{Parser, Subcommand};
use std::path::PathBuf;

#[derive(Parser)]
#[command(name = "mcm", version, about = "Chunkyard — Minecraft server manager")]
struct Cli {
    #[arg(long, global = true)]
    data_dir: Option<PathBuf>,
    #[arg(long, global = true, help = "Configuration file (or CHUNKYARD_CONFIG)")]
    config: Option<PathBuf>,
    #[command(subcommand)]
    command: Option<Command>,
}
#[derive(Subcommand)]
enum Command {
    /// Serve the built web UI and authenticated HTTP API.
    Serve {
        #[arg(long)]
        listen: Option<std::net::SocketAddr>,
    },
    /// Validate file/environment configuration and print the effective settings.
    Config {
        #[command(subcommand)]
        command: ConfigCommand,
    },
    /// Apply database migrations and exit.
    Migrate,
}
#[derive(Subcommand)]
enum ConfigCommand {
    Check,
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
            let backend = chunkyard_server::wiring::build_state(&config).await?;
            backend.start_background();
            tracing::info!(listen = %listener.local_addr()?, "backend listening");
            let result = axum::serve(
                listener,
                chunkyard_server::ui::router(backend.state.clone(), config.http.ui_dir.as_deref())
                    .await?
                    .into_make_service_with_connect_info::<std::net::SocketAddr>(),
            )
            .with_graceful_shutdown(shutdown_signal())
            .await;
            backend.shutdown().await;
            return result.context("HTTP server failed");
        }
        _ => (),
    }
    let database = chunkyard_db::Database::open(&config.data_dir.join("mcm.db")).await?;
    database.close().await;
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
