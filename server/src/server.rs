use std::net::SocketAddr;
use std::path::PathBuf;

use axum::body::Body;
use axum::http::{Request, StatusCode};
use axum::middleware::{self, Next};
use axum::response::Response;
use axum::Router;
use tower_http::cors::CorsLayer;
use tower_http::services::{ServeDir, ServeFile};

use crate::manifest::is_excluded;

/// Не отдаём исключённые папки даже напрямую по URL
/// (в манифесте их нет, но перестраховываемся на случай ручных запросов).
async fn block_excluded(req: Request<Body>, next: Next) -> Result<Response, StatusCode> {
    let inner = req.uri().path().strip_prefix("/files/").unwrap_or("");
    // Декодируем %XX, чтобы нельзя было обойти блокировку через `/%63loud/...`.
    let decoded = percent_decode(inner);
    if is_excluded(&decoded) {
        return Err(StatusCode::NOT_FOUND);
    }
    Ok(next.run(req).await)
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(&h), Some(&l)) = (bytes.get(i + 1), bytes.get(i + 2)) {
                if let (Some(hi), Some(lo)) = (hex_val(h), hex_val(l)) {
                    out.push(hi << 4 | lo);
                    i += 3;
                    continue;
                }
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

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
        .layer(middleware::from_fn(block_excluded))
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
