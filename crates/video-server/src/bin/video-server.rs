use directories::ProjectDirs;
use std::net::SocketAddr;
use std::path::PathBuf;

use manatan_video_server::create_router;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

fn resolve_data_dir() -> PathBuf {
    if let Ok(dir) = std::env::var("DATA_DIR") {
        return PathBuf::from(dir);
    }

    let proj_dirs = ProjectDirs::from("", "", "manatan")
        .expect("Could not determine home directory");
    proj_dirs.data_dir().join("video-server")
}

#[tokio::main]
async fn main() {
    tracing_subscriber::registry()
        .with(tracing_subscriber::fmt::layer())
        .init();

    let data_dir = resolve_data_dir();

    std::fs::create_dir_all(&data_dir).expect("Failed to create data directory");

    tracing::info!("Using data directory: {}", data_dir.display());

    let app = create_router(data_dir);

    let addr: SocketAddr = "0.0.0.0:3000".parse().expect("Invalid address");
    let listener = tokio::net::TcpListener::bind(addr).await.expect("Failed to bind");

    tracing::info!("Video server running at http://{}", addr);

    axum::serve(listener, app).await.expect("Server failed");
}
