mod manifest;
mod server;

use clap::{Parser, Subcommand};
use std::path::PathBuf;

/// sccs-server: manifest.json generation + Star Conflict game file distribution (MVP).
#[derive(Parser, Debug)]
#[command(name = "sccs-server", version)]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand, Debug)]
enum Cmd {
    /// Scan game-dir, compute sha256 and write manifest.json
    Generate {
        /// Game root on the server disk (what we distribute)
        #[arg(long, default_value = "game")]
        game_dir: PathBuf,
        /// Where to put the manifest (default: <game-dir>/manifest.json)
        #[arg(long)]
        output: Option<PathBuf>,
        /// Build version (default: v3)
        #[arg(long)]
        version: Option<String>,
    },
    /// Serve game-dir over HTTP
    Serve {
        #[arg(long, default_value = "game")]
        game_dir: PathBuf,
        #[arg(long, default_value = "127.0.0.1")]
        host: String,
        #[arg(long, default_value_t = 8080)]
        port: u16,
    },
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "sccs_server=info,tower_http=info".into()),
        )
        .init();

    let cli = Cli::parse();
    let res = match cli.cmd {
        Cmd::Generate {
            game_dir,
            output,
            version,
        } => cmd_generate(game_dir, output, version),
        Cmd::Serve {
            game_dir,
            host,
            port,
        } => server::serve(game_dir, host, port).await,
    };

    if let Err(e) = res {
        eprintln!("error: {e}");
        std::process::exit(1);
    }
}

fn cmd_generate(
    game_dir: PathBuf,
    output: Option<PathBuf>,
    version: Option<String>,
) -> Result<(), String> {
    if !game_dir.exists() {
        return Err(format!("game-dir does not exist: {}", game_dir.display()));
    }
    let version = version.unwrap_or_else(|| "v3".into());

    let m = manifest::generate_manifest(&game_dir, version)?;
    let out = output.unwrap_or_else(|| game_dir.join("manifest.json"));
    let json = serde_json::to_string_pretty(&m).map_err(|e| e.to_string())?;
    std::fs::write(&out, json).map_err(|e| e.to_string())?;

    let total_bytes: u64 = m.files.iter().map(|f| f.size).sum();
    println!(
        "manifest: version={} files={} bytes={} -> {}",
        m.version,
        m.files.len(),
        total_bytes,
        out.display()
    );
    Ok(())
}
