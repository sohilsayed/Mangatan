use std::path::{Path, PathBuf};
use std::fs;
use anyhow::{Context, Result};
use crate::ln_server::types::*;
use std::collections::HashMap;

pub struct LnStorage {
    base_path: PathBuf,
}

impl LnStorage {
    pub fn new(data_dir: &Path) -> Self {
        let base_path = data_dir.join("local-ln");
        if !base_path.exists() {
            let _ = fs::create_dir_all(&base_path);
            let _ = fs::create_dir_all(base_path.join("books"));
            let _ = fs::create_dir_all(base_path.join("progress"));
            let _ = fs::create_dir_all(base_path.join("categories"));
        }
        Self { base_path }
    }

    fn books_path(&self) -> PathBuf {
        self.base_path.join("books")
    }

    fn progress_path(&self) -> PathBuf {
        self.base_path.join("progress")
    }

    fn categories_path(&self) -> PathBuf {
        self.base_path.join("categories")
    }

    pub fn list_books(&self) -> Result<Vec<LNMetadata>> {
        let mut books = Vec::new();
        if let Ok(entries) = fs::read_dir(self.books_path()) {
            for entry in entries.flatten() {
                if entry.path().is_dir() {
                    if let Ok(metadata) = self.get_book_metadata(&entry.file_name().to_string_lossy()) {
                        books.push(metadata);
                    }
                }
            }
        }
        books.sort_by(|a, b| b.added_at.cmp(&a.added_at));
        Ok(books)
    }

    pub fn get_book_metadata(&self, book_id: &str) -> Result<LNMetadata> {
        let path = self.books_path().join(book_id).join("metadata.json");
        let content = fs::read_to_string(path)?;
        let metadata: LNMetadata = serde_json::from_str(&content)?;
        Ok(metadata)
    }

    pub fn update_book_metadata(&self, book_id: &str, metadata: &LNMetadata) -> Result<()> {
        let path = self.books_path().join(book_id).join("metadata.json");
        fs::write(path, serde_json::to_string_pretty(metadata)?)?;
        Ok(())
    }

    pub fn save_book(&self, metadata: &LNMetadata, chapters: &[String], images: &HashMap<String, Vec<u8>>) -> Result<()> {
        let book_dir = self.books_path().join(&metadata.id);
        fs::create_dir_all(&book_dir)?;
        fs::create_dir_all(book_dir.join("chapters"))?;
        fs::create_dir_all(book_dir.join("images"))?;

        // Save metadata
        let metadata_path = book_dir.join("metadata.json");
        fs::write(metadata_path, serde_json::to_string_pretty(metadata)?)?;

        // Save chapters
        for (i, html) in chapters.iter().enumerate() {
            let chapter_path = book_dir.join("chapters").join(format!("{}.html", i));
            fs::write(chapter_path, html)?;
        }

        // Save images
        for (name, data) in images {
            // We should be careful about subdirectories in image names
            let image_path = book_dir.join("images").join(name);
            if let Some(parent) = image_path.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::write(image_path, data)?;
        }

        Ok(())
    }

    pub fn delete_book(&self, book_id: &str) -> Result<()> {
        let book_dir = self.books_path().join(book_id);
        if book_dir.exists() {
            fs::remove_dir_all(book_dir)?;
        }
        let progress_file = self.progress_path().join(format!("{}.json", book_id));
        if progress_file.exists() {
            fs::remove_file(progress_file)?;
        }
        Ok(())
    }

    pub fn get_chapter(&self, book_id: &str, index: usize) -> Result<String> {
        let path = self.books_path().join(book_id).join("chapters").join(format!("{}.html", index));
        let content = fs::read_to_string(path)?;
        Ok(content)
    }

    pub fn get_image(&self, book_id: &str, image_path: &str) -> Result<Vec<u8>> {
        let path = self.books_path().join(book_id).join("images").join(image_path);
        let data = fs::read(path)?;
        Ok(data)
    }

    pub fn get_progress(&self, book_id: &str) -> Result<Option<LNProgress>> {
        let path = self.progress_path().join(format!("{}.json", book_id));
        if !path.exists() {
            return Ok(None);
        }
        let content = fs::read_to_string(path)?;
        let progress: LNProgress = serde_json::from_str(&content)?;
        Ok(Some(progress))
    }

    pub fn save_progress(&self, book_id: &str, progress: &LNProgress) -> Result<()> {
        let path = self.progress_path().join(format!("{}.json", book_id));
        fs::write(path, serde_json::to_string_pretty(progress)?)?;
        Ok(())
    }

    pub fn get_highlights(&self, book_id: &str) -> Result<LNHighlights> {
        if let Some(progress) = self.get_progress(book_id)? {
            Ok(LNHighlights { highlights: progress.highlights })
        } else {
            Ok(LNHighlights { highlights: Vec::new() })
        }
    }

    pub fn save_highlights(&self, book_id: &str, highlights: &LNHighlights) -> Result<()> {
        let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as i64;
        let mut progress = self.get_progress(book_id)?.unwrap_or_else(|| LNProgress {
            chapter_index: 0,
            page_number: None,
            chapter_char_offset: 0,
            total_chars_read: 0,
            sentence_text: String::new(),
            chapter_progress: 0.0,
            total_progress: 0.0,
            block_id: None,
            block_local_offset: None,
            context_snippet: None,
            last_read: None,
            last_modified: Some(now),
            sync_version: None,
            device_id: None,
            highlights: Vec::new(),
        });
        progress.highlights = highlights.highlights.clone();
        progress.last_modified = Some(now);
        self.save_progress(book_id, &progress)
    }

    pub fn list_categories(&self) -> Result<Vec<LNCategory>> {
        let mut categories = Vec::new();
        let path = self.categories_path().join("categories.json");
        if path.exists() {
            let content = fs::read_to_string(path)?;
            categories = serde_json::from_str(&content)?;
        }
        categories.sort_by(|a, b| a.order.cmp(&b.order));
        Ok(categories)
    }

    pub fn save_categories(&self, categories: &[LNCategory]) -> Result<()> {
        let path = self.categories_path().join("categories.json");
        fs::write(path, serde_json::to_string_pretty(categories)?)?;
        Ok(())
    }

    pub fn get_category_metadata(&self, category_id: &str) -> Result<Option<LNCategoryMetadata>> {
        let path = self.categories_path().join(format!("{}_meta.json", category_id));
        if !path.exists() {
            return Ok(None);
        }
        let content = fs::read_to_string(path)?;
        let metadata: LNCategoryMetadata = serde_json::from_str(&content)?;
        Ok(Some(metadata))
    }

    pub fn save_category_metadata(&self, category_id: &str, metadata: &LNCategoryMetadata) -> Result<()> {
        let path = self.categories_path().join(format!("{}_meta.json", category_id));
        fs::write(path, serde_json::to_string_pretty(metadata)?)?;
        Ok(())
    }

    pub fn list_category_metadata(&self) -> Result<HashMap<String, LNCategoryMetadata>> {
        let mut results = HashMap::new();
        if let Ok(entries) = fs::read_dir(self.categories_path()) {
            for entry in entries.flatten() {
                let name = entry.file_name().to_string_lossy().to_string();
                if name.ends_with("_meta.json") {
                    let id = name.replace("_meta.json", "");
                    if let Ok(meta) = self.get_category_metadata(&id) {
                        if let Some(meta) = meta {
                            results.insert(id, meta);
                        }
                    }
                }
            }
        }
        Ok(results)
    }
}
