use std::net::SocketAddr;
use std::path::PathBuf;

use axum::Router;
use tower_http::cors::CorsLayer;
use tower_http::services::{ServeDir, ServeFile};

/// Запускает HTTP-сервер раздачи:
/// - GET /health
/// - GET /manifest.json
/// - GET /files/*  (с поддержкой Range — её даёт ServeDir из tower-http)
pub async fn serve(game_dir: PathBuf, host: String, port: u16) -> Result<(), String> {
    let game_dir = game_dir
        .canonicalize()
        .map_err(|e| format!("game-dir не найден: {e}"))?;

    let manifest_path = game_dir.join("manifest.json");
    if !manifest_path.exists() {
        eprintln!(
            "ВНИМАНИЕ: {} не найден. Сначала выполните `generate`.",
            manifest_path.display()
        );
    }

    let files_service = ServeDir::new(&game_dir);
    let manifest_service = ServeFile::new(manifest_path);

    let app = Router::new()
        .route(
            "/health",
            axum::routing::get(|| async { "ok" }),
        )
        .nest_service("/files", files_service)
        .nest_service("/manifest.json", manifest_service)
        .layer(CorsLayer::permissive())
        .layer(tower_http::trace::TraceLayer::new_for_http());

    let addr: SocketAddr = format!("{host}:{port}")
        .parse()
        .map_err(|e| format!("bad host:port: {e}"))?;

    println!("serving {} at http://{addr}", game_dir.display());
    println!("  manifest -> http://{addr}/manifest.json");
    println!("  files    -> http://{addr}/files/<path>");

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|e| e.to_string())?;
    axum::serve(listener, app).await.map_err(|e| e.to_string())
}
