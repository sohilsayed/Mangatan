use axum::{
    extract::{Path, Query, State, Multipart},
    http::StatusCode,
    response::{IntoResponse, Json},
    routing::{get, post, put, delete},
    Router,
};
use serde::Deserialize;
use std::sync::Arc;
use crate::ln_server::types::*;
use crate::ln_server::storage::LnStorage;
use crate::ln_server::parser::EpubParser;
use crate::ln_server::search::LnSearch;
use std::path::PathBuf;

#[derive(Clone)]
pub struct LnState {
    pub storage: Arc<LnStorage>,
}

pub fn create_router(data_dir: PathBuf) -> Router {
    let state = LnState {
        storage: Arc::new(LnStorage::new(&data_dir)),
    };

    Router::new()
        .route("/api/v1/ln", get(list_books))
        .route("/api/v1/ln/:id", get(get_book).put(update_book).delete(delete_book))
        .route("/api/v1/ln/:id/file", get(get_book_file))
        .route("/api/v1/ln/:id/content", get(get_book_content))
        .route("/api/v1/ln/import", post(import_book))
        .route("/api/v1/ln/import-from-path", post(import_from_path))
        .route("/api/v1/ln/:id/chapters", get(get_chapters))
        .route("/api/v1/ln/:id/chapter/:index", get(get_chapter))
        .route("/api/v1/ln/:id/image/*path", get(get_image))
        .route("/api/v1/ln/:id/progress", get(get_progress).put(save_progress))
        .route("/api/v1/ln/:id/highlights", get(get_highlights).post(add_highlight))
        .route("/api/v1/ln/:id/highlights/:hid", delete(delete_highlight))
        .route("/api/v1/ln/:id/search", get(search_book))
        .route("/api/v1/ln/categories", get(list_categories).post(create_category))
        .route("/api/v1/ln/categories/metadata", get(list_category_metadata))
        .route("/api/v1/ln/categories/:id", put(update_category).delete(delete_category))
        .route("/api/v1/ln/categories/:id/metadata", get(get_category_metadata).put(save_category_metadata))
        .with_state(state)
}

async fn list_books(State(state): State<LnState>) -> impl IntoResponse {
    match state.storage.list_books() {
        Ok(books) => Json(books).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

async fn list_category_metadata(State(state): State<LnState>) -> impl IntoResponse {
    match state.storage.list_category_metadata() {
        Ok(results) => Json(results).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

async fn get_category_metadata(State(state): State<LnState>, Path(id): Path<String>) -> impl IntoResponse {
    match state.storage.get_category_metadata(&id) {
        Ok(Some(metadata)) => Json(metadata).into_response(),
        Ok(None) => StatusCode::NOT_FOUND.into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

async fn save_category_metadata(State(state): State<LnState>, Path(id): Path<String>, Json(metadata): Json<LNCategoryMetadata>) -> impl IntoResponse {
    match state.storage.save_category_metadata(&id, &metadata) {
        Ok(_) => StatusCode::OK.into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

async fn update_book(State(state): State<LnState>, Path(id): Path<String>, Json(metadata): Json<LNMetadata>) -> impl IntoResponse {
    // This is a bit tricky because save_book takes chapters and images too.
    // Let's add a specialized update_metadata method to storage.
    match state.storage.update_book_metadata(&id, &metadata) {
        Ok(_) => StatusCode::OK.into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

async fn get_book(State(state): State<LnState>, Path(id): Path<String>) -> impl IntoResponse {
    match state.storage.get_book_metadata(&id) {
        Ok(metadata) => Json(metadata).into_response(),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn delete_book(State(state): State<LnState>, Path(id): Path<String>) -> impl IntoResponse {
    match state.storage.delete_book(&id) {
        Ok(_) => StatusCode::OK.into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

async fn import_book(State(state): State<LnState>, mut multipart: Multipart) -> impl IntoResponse {
    let mut data = None;
    let mut book_id = None;

    while let Ok(Some(field)) = multipart.next_field().await {
        if let Some(name) = field.name() {
            match name {
                "file" => {
                    data = Some(field.bytes().await.map_err(|e| e.to_string()));
                }
                "id" => {
                    book_id = Some(field.text().await.map_err(|e| e.to_string()));
                }
                _ => {}
            }
        }
    }

    if let Some(Ok(data)) = data {
        let book_id = match book_id {
            Some(Ok(id)) => id,
            _ => uuid::Uuid::new_v4().to_string(),
        };

        match EpubParser::parse(&data, &book_id) {
            Ok((metadata, chapters, images)) => {
                if let Err(e) = state.storage.save_book(&metadata, &chapters, &images, Some(&data)) {
                    return (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response();
                }
                return Json(metadata).into_response();
            }
            Err(e) => return (StatusCode::BAD_REQUEST, e.to_string()).into_response(),
        }
    }
    StatusCode::BAD_REQUEST.into_response()
}

#[derive(Deserialize)]
struct ImportFromPathRequest {
    path: String,
}

async fn import_from_path(State(state): State<LnState>, Json(req): Json<ImportFromPathRequest>) -> impl IntoResponse {
    let data = match std::fs::read(&req.path) {
        Ok(d) => d,
        Err(e) => return (StatusCode::BAD_REQUEST, e.to_string()).into_response(),
    };
    let book_id = uuid::Uuid::new_v4().to_string();
    match EpubParser::parse(&data, &book_id) {
        Ok((metadata, chapters, images)) => {
            if let Err(e) = state.storage.save_book(&metadata, &chapters, &images, Some(&data)) {
                return (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response();
            }
            Json(metadata).into_response()
        }
        Err(e) => (StatusCode::BAD_REQUEST, e.to_string()).into_response(),
    }
}

async fn get_chapters(State(state): State<LnState>, Path(id): Path<String>) -> impl IntoResponse {
    match state.storage.get_book_metadata(&id) {
        Ok(metadata) => {
            let mut chapters = Vec::new();
            for i in 0..metadata.chapter_count {
                chapters.push(i);
            }
            Json(chapters).into_response()
        }
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn get_chapter(State(state): State<LnState>, Path((id, index)): Path<(String, usize)>) -> impl IntoResponse {
    match state.storage.get_chapter(&id, index) {
        Ok(content) => content.into_response(),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn get_image(State(state): State<LnState>, Path((id, path)): Path<(String, String)>) -> impl IntoResponse {
    match state.storage.get_image(&id, &path) {
        Ok(data) => {
            let mime = mime_guess::from_path(&path).first_or_octet_stream();
            ([(axum::http::header::CONTENT_TYPE, mime.as_ref())], data).into_response()
        }
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn get_progress(State(state): State<LnState>, Path(id): Path<String>) -> impl IntoResponse {
    match state.storage.get_progress(&id) {
        Ok(Some(progress)) => Json(progress).into_response(),
        Ok(None) => StatusCode::NOT_FOUND.into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

async fn get_book_file(State(state): State<LnState>, Path(id): Path<String>) -> impl IntoResponse {
    match state.storage.get_book_file(&id) {
        Ok(data) => ([(axum::http::header::CONTENT_TYPE, "application/epub+zip")], data).into_response(),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn get_book_content(State(state): State<LnState>, Path(id): Path<String>) -> impl IntoResponse {
    match state.storage.get_book_content(&id) {
        Ok(content) => Json(content).into_response(),
        Err(_) => StatusCode::NOT_FOUND.into_response(),
    }
}

async fn save_progress(State(state): State<LnState>, Path(id): Path<String>, Json(progress): Json<LNProgress>) -> impl IntoResponse {
    match state.storage.save_progress(&id, &progress) {
        Ok(_) => StatusCode::OK.into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

async fn get_highlights(State(state): State<LnState>, Path(id): Path<String>) -> impl IntoResponse {
    match state.storage.get_highlights(&id) {
        Ok(highlights) => Json(highlights).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

async fn add_highlight(State(state): State<LnState>, Path(id): Path<String>, Json(highlight): Json<LNHighlight>) -> impl IntoResponse {
    match state.storage.get_highlights(&id) {
        Ok(mut highlights) => {
            highlights.highlights.push(highlight);
            match state.storage.save_highlights(&id, &highlights) {
                Ok(_) => StatusCode::OK.into_response(),
                Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
            }
        }
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

async fn delete_highlight(State(state): State<LnState>, Path((id, hid)): Path<(String, String)>) -> impl IntoResponse {
    match state.storage.get_highlights(&id) {
        Ok(mut highlights) => {
            highlights.highlights.retain(|h| h.id != hid);
            match state.storage.save_highlights(&id, &highlights) {
                Ok(_) => StatusCode::OK.into_response(),
                Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
            }
        }
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

#[derive(Deserialize)]
struct SearchQuery {
    q: String,
}

async fn search_book(State(state): State<LnState>, Path(id): Path<String>, Query(query): Query<SearchQuery>) -> impl IntoResponse {
    match LnSearch::search(&state.storage, &id, &query.q) {
        Ok(results) => Json(results).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

async fn list_categories(State(state): State<LnState>) -> impl IntoResponse {
    match state.storage.list_categories() {
        Ok(categories) => Json(categories).into_response(),
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

async fn create_category(State(state): State<LnState>, Json(category): Json<LNCategory>) -> impl IntoResponse {
    match state.storage.list_categories() {
        Ok(mut categories) => {
            categories.push(category.clone());
            match state.storage.save_categories(&categories) {
                Ok(_) => Json(category).into_response(),
                Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
            }
        }
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

async fn update_category(State(state): State<LnState>, Path(id): Path<String>, Json(category): Json<LNCategory>) -> impl IntoResponse {
    match state.storage.list_categories() {
        Ok(mut categories) => {
            if let Some(c) = categories.iter_mut().find(|c| c.id == id) {
                *c = category.clone();
                match state.storage.save_categories(&categories) {
                    Ok(_) => Json(category).into_response(),
                    Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
                }
            } else {
                StatusCode::NOT_FOUND.into_response()
            }
        }
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}

async fn delete_category(State(state): State<LnState>, Path(id): Path<String>) -> impl IntoResponse {
    match state.storage.list_categories() {
        Ok(mut categories) => {
            categories.retain(|c| c.id != id);
            match state.storage.save_categories(&categories) {
                Ok(_) => StatusCode::OK.into_response(),
                Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
            }
        }
        Err(e) => (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()).into_response(),
    }
}
