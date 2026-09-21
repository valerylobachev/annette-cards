mod app;
mod config;
mod db;
mod error;
mod health;
mod static_files;

use std::sync::Arc;

use anyhow::Context;
use clap::{Parser, Subcommand};
use tokio::net::TcpListener;
use tracing_subscriber::EnvFilter;

use crate::{app::AppState, config::Config};

/// Annette Cards server: API, sync and the embedded PWA.
#[derive(Parser)]
#[command(version)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Run the HTTP server
    Serve,
    /// Print the OpenAPI spec (JSON) to stdout
    Openapi,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Command::Serve => serve().await,
        Command::Openapi => print_openapi(),
    }
}

async fn serve() -> anyhow::Result<()> {
    let config = Config::load().context("invalid configuration")?;
    init_tracing();

    let pool = db::connect(&config.database_url).await?;
    db::migrate(&pool).await?;
    tracing::info!(database = %config.database_url, "migrations applied");

    let listener = TcpListener::bind(config.bind)
        .await
        .with_context(|| format!("cannot listen on {}", config.bind))?;
    tracing::info!(address = %config.bind, version = env!("CARGO_PKG_VERSION"), "listening");

    let app = app::router(Arc::new(AppState { pool, config }));
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

fn print_openapi() -> anyhow::Result<()> {
    let json = app::openapi().to_pretty_json()?;
    println!("{json}");
    Ok(())
}

/// `RUST_LOG` controls the level (default `info`). Human-readable logs in debug builds, JSON in release builds.
fn init_tracing() {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    let logs = tracing_subscriber::fmt().with_env_filter(filter);
    if cfg!(debug_assertions) {
        logs.init();
    } else {
        logs.json().init();
    }
}

/// Resolves on Ctrl-C or SIGTERM (systemd stop) so in-flight requests can finish.
async fn shutdown_signal() {
    let ctrl_c = async {
        tokio::signal::ctrl_c()
            .await
            .expect("cannot listen for Ctrl-C");
    };
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("cannot listen for SIGTERM")
            .recv()
            .await;
    };
    tokio::select! {
        () = ctrl_c => {},
        () = terminate => {},
    }
    tracing::info!("shutting down");
}
