use crate::ln_server::types::SearchResult;
use crate::ln_server::storage::LnStorage;
use anyhow::Result;

pub struct LnSearch;

impl LnSearch {
    pub fn search(storage: &LnStorage, book_id: &str, query: &str) -> Result<Vec<SearchResult>> {
        let metadata = storage.get_book_metadata(book_id)?;
        let mut results = Vec::new();
        let query_lower = query.to_lowercase();

        for i in 0..metadata.chapter_count {
            if let Ok(html) = storage.get_chapter(book_id, i) {
                // Strip HTML tags for searching
                let text = ammonia::clean_text(&html);
                let text_lower = text.to_lowercase();

                let mut pos = 0;
                while let Some(start) = text_lower[pos..].find(&query_lower) {
                    let absolute_start = pos + start;

                    // Get context
                    let context_start = absolute_start.saturating_sub(30);
                    let context_end = (absolute_start + query.len() + 30).min(text.len());
                    let context = text[context_start..context_end].to_string();

                    results.push(SearchResult {
                        chapter_index: i,
                        text: context,
                        position: absolute_start,
                    });

                    pos = absolute_start + 1;
                    if results.iter().filter(|r| r.chapter_index == i).count() >= 10 {
                        break; // Limit results per chapter
                    }
                }
            }
            if results.len() >= 50 {
                break; // Limit total results
            }
        }

        Ok(results)
    }
}
