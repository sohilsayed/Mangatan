#[cfg(test)]
mod tests {
    use super::parser::EpubParser;
    use super::storage::LnStorage;
    use super::search::LnSearch;
    use std::collections::HashMap;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn test_storage_and_search() {
        let dir = tempdir().unwrap();
        let storage = LnStorage::new(dir.path());

        let book_id = "test-book";
        let metadata = crate::ln_server::types::LNMetadata {
            id: book_id.to_string(),
            title: "Test Book".to_string(),
            author: "Author".to_string(),
            cover: None,
            added_at: 1000,
            chapter_count: 1,
            stats: crate::ln_server::types::BookStats {
                chapter_lengths: vec![100],
                total_length: 100,
                block_maps: Some(vec![
                    crate::ln_server::types::BlockIndexMap {
                        block_id: "ch0-b0".to_string(),
                        start_offset: 0,
                        end_offset: 100,
                    }
                ]),
            },
            toc: vec![],
            language: "en".to_string(),
            category_ids: vec![],
            language_settings: HashMap::new(),
        };

        let chapters = vec!["<html><body><p data-block-id=\"ch0-b0\">This is a test chapter with some content.</p></body></html>".to_string()];
        let images = HashMap::new();

        storage.save_book(&metadata, &chapters, &images).unwrap();

        // Test retrieval
        let retrieved_meta = storage.get_book_metadata(book_id).unwrap();
        assert_eq!(retrieved_meta.title, "Test Book");

        let retrieved_chapter = storage.get_chapter(book_id, 0).unwrap();
        assert!(retrieved_chapter.contains("test chapter"));

        // Test search
        let search_results = LnSearch::search(&storage, book_id, "test").unwrap();
        assert_eq!(search_results.len(), 1);
        assert_eq!(search_results[0].chapter_index, 0);
        assert!(search_results[0].text.contains("test"));

        // Test progress
        let progress = crate::ln_server::types::LNProgress {
            chapter_index: 0,
            page_number: None,
            chapter_char_offset: 10,
            total_chars_read: 10,
            sentence_text: "test".to_string(),
            chapter_progress: 0.1,
            total_progress: 0.1,
            block_id: Some("ch0-b0".to_string()),
            block_local_offset: Some(10),
            context_snippet: None,
            last_read: Some(2000),
            last_modified: Some(2000),
            sync_version: None,
            device_id: None,
            highlights: vec![],
        };
        storage.save_progress(book_id, &progress).unwrap();
        let retrieved_progress = storage.get_progress(book_id).unwrap().unwrap();
        assert_eq!(retrieved_progress.chapter_char_offset, 10);
    }
}
