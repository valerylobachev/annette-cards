mod admin;
mod app;
mod auth;
mod clock;
mod config;
mod db;
mod error;
mod health;
mod security;
mod static_files;
#[cfg(test)]
mod test_support;

use std::{io::BufRead, net::SocketAddr, sync::Arc};

use anyhow::{Context, bail};
use clap::{Parser, Subcommand};
use sqlx::SqlitePool;
use tokio::net::TcpListener;
use tracing_subscriber::EnvFilter;

use crate::{
    admin::invites,
    app::AppState,
    auth::{
        password,
        users::{self, NewUser},
    },
    config::{Config, LogFormat},
};

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
    /// Create an account; asks for the password twice (hidden input)
    CreateUser {
        #[arg(long)]
        email: String,
        /// Display name (default: the part of the email before `@`)
        #[arg(long)]
        name: Option<String>,
        /// Make the user an admin (can create invites)
        #[arg(long)]
        admin: bool,
        /// Read the password from the first line of stdin instead of prompting (for scripts)
        #[arg(long)]
        password_stdin: bool,
    },
    /// Create a single-use registration invite and print its code and link
    Invite {
        /// Who the invite is for (shown in the admin invite list)
        #[arg(long)]
        note: Option<String>,
        /// Days until the invite expires (1–90)
        #[arg(long, default_value_t = 7)]
        days: i64,
        /// Email of the admin creating the invite (default: the first admin)
        #[arg(long)]
        by: Option<String>,
    },
    /// Print the OpenAPI spec (JSON) to stdout
    Openapi,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let cli = Cli::parse();
    match cli.command {
        Command::Serve => serve().await,
        Command::CreateUser {
            email,
            name,
            admin,
            password_stdin,
        } => create_user(&email, name.as_deref(), admin, password_stdin).await,
        Command::Invite { note, days, by } => {
            create_invite(note.as_deref(), days, by.as_deref()).await
        }
        Command::Openapi => print_openapi(),
    }
}

async fn serve() -> anyhow::Result<()> {
    let config = Config::load().context("invalid configuration")?;
    init_tracing(config.log_format);
    if config.public_url.is_none() && !config.dev_origins {
        tracing::warn!(
            "neither ANNETTE_PUBLIC_URL nor ANNETTE_DEV_ORIGINS is set: every POST/PUT/DELETE to /api is rejected"
        );
    }

    let pool = db::connect(&config.database_url).await?;
    db::migrate(&pool).await?;
    tracing::info!(database = %config.database_url, "migrations applied");

    let listener = TcpListener::bind(config.bind)
        .await
        .with_context(|| format!("cannot listen on {}", config.bind))?;
    tracing::info!(address = %config.bind, version = env!("CARGO_PKG_VERSION"), "listening");

    auth::spawn_session_cleanup(pool.clone());
    let app = app::router(Arc::new(AppState { pool, config }));
    // The peer address is the rate limiter's fallback key when no X-Forwarded-For header is present.
    let app = app.into_make_service_with_connect_info::<SocketAddr>();
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await?;
    Ok(())
}

/// Opens (and migrates) the configured database for a CLI command.
async fn open_database() -> anyhow::Result<(Config, SqlitePool)> {
    let config = Config::load().context("invalid configuration")?;
    let pool = db::connect(&config.database_url).await?;
    db::migrate(&pool).await?;
    Ok((config, pool))
}

async fn create_user(
    email: &str,
    name: Option<&str>,
    is_admin: bool,
    password_stdin: bool,
) -> anyhow::Result<()> {
    let (_, pool) = open_database().await?;
    let password = if password_stdin {
        read_password_from_stdin()?
    } else {
        prompt_new_password()?
    };
    if password.chars().count() < password::MIN_PASSWORD_CHARS {
        bail!(
            "the password must have at least {} characters",
            password::MIN_PASSWORD_CHARS
        );
    }
    let default_name = email.split('@').next().unwrap_or(email);
    let new = NewUser {
        email,
        display_name: name.unwrap_or(default_name),
        password: &password,
        is_admin,
    };
    let mut conn = pool.acquire().await?;
    let user = users::create_user(&mut conn, new)
        .await
        .map_err(|err| anyhow::anyhow!("cannot create the user: {err}"))?;
    let role = if user.is_admin { "admin" } else { "user" };
    println!("Created {role} {} ({})", user.email, user.id);
    Ok(())
}

fn prompt_new_password() -> anyhow::Result<String> {
    let password = rpassword::prompt_password("Password (at least 10 characters): ")?;
    let repeated = rpassword::prompt_password("Repeat the password: ")?;
    if password != repeated {
        bail!("the passwords do not match");
    }
    Ok(password)
}

fn read_password_from_stdin() -> anyhow::Result<String> {
    let mut line = String::new();
    std::io::stdin().lock().read_line(&mut line)?;
    Ok(line.trim_end_matches(['\r', '\n']).to_string())
}

async fn create_invite(note: Option<&str>, days: i64, by: Option<&str>) -> anyhow::Result<()> {
    let (config, pool) = open_database().await?;
    let creator = match by {
        Some(email) => users::find_by_email(&pool, email).await?,
        None => users::first_admin(&pool).await?,
    };
    let Some(creator) = creator.filter(|user| user.is_admin) else {
        bail!(
            "no admin account found: create one with `create-user --admin` or pass --by <admin email>"
        );
    };

    let invite = invites::create_invite(&pool, &creator.id, note, days, clock::now_ms())
        .await
        .map_err(|err| anyhow::anyhow!("cannot create the invite: {err}"))?;
    println!("Invite code: {}", invite.code);
    match &config.public_url {
        Some(url) => println!("Link: {}", invites::invite_link(url, &invite.code)),
        None => println!("Link: set ANNETTE_PUBLIC_URL to print the full registration link"),
    }
    println!("Expires in {days} days.");
    Ok(())
}

fn print_openapi() -> anyhow::Result<()> {
    let json = app::openapi().to_pretty_json()?;
    println!("{json}");
    Ok(())
}

/// `RUST_LOG` controls the level (default `info`); `ANNETTE_LOG_FORMAT` the format (default: `pretty` in debug
/// builds, `json` in release builds).
fn init_tracing(format: LogFormat) {
    let filter = EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info"));
    let logs = tracing_subscriber::fmt().with_env_filter(filter);
    match format {
        LogFormat::Pretty => logs.init(),
        LogFormat::Json => logs.json().init(),
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
