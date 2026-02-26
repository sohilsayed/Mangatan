use std::collections::HashMap;
use std::io::{Read, Cursor};
use zip::ZipArchive;
use quick_xml::reader::Reader;
use quick_xml::events::Event;
use anyhow::{anyhow, Result};
use crate::ln_server::types::*;
use kuchiki::traits::*;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
use base64::Engine;

pub struct EpubParser;

impl EpubParser {
    pub fn parse(data: &[u8], book_id: &str) -> Result<(LNMetadata, Vec<String>, HashMap<String, Vec<u8>>)> {
        let reader = Cursor::new(data);
        let mut archive = ZipArchive::new(reader)?;

        // 1. Find OPF path
        let opf_path = Self::get_opf_path(&mut archive)?;
        let opf_content = Self::read_zip_file(&mut archive, &opf_path)?;

        // 2. Parse OPF
        let (metadata_raw, manifest, spine) = Self::parse_opf(&opf_content)?;

        // 3. Extract metadata
        let title = metadata_raw.get("title").cloned().unwrap_or_else(|| "Unknown Title".to_string());
        let author = metadata_raw.get("creator").cloned().unwrap_or_else(|| "Unknown Author".to_string());
        let language = metadata_raw.get("language").cloned().unwrap_or_else(|| "unknown".to_string());

        // 4. Extract chapters
        let mut chapters = Vec::new();
        let mut chapter_lengths = Vec::new();
        let mut images = HashMap::new();

        let opf_dir_str = Path::new(&opf_path).parent().unwrap_or(Path::new("")).to_string_lossy().to_string();
        let opf_dir = Path::new(&opf_dir_str);

        for idref in &spine {
            if let Some(href) = manifest.get(idref).map(|m| &m.0) {
                let full_path = Self::resolve_path(opf_dir, href);
                if let Ok(content) = Self::read_zip_file(&mut archive, &full_path) {
                    let html = String::from_utf8_lossy(&content).to_string();
                    let (processed_html, chapter_images) = Self::process_chapter_html(&html, &full_path, &mut archive)?;

                    for (img_path, img_data) in chapter_images {
                        images.insert(img_path, img_data);
                    }

                    // Simple character count (clean text)
                    let doc = kuchiki::parse_html().one(processed_html.as_str());
                    let text = doc.text_contents();
                    chapter_lengths.push(text.chars().filter(|c| !c.is_whitespace()).count());
                    chapters.push(processed_html);
                }
            }
        }

        // 5. Extract cover
        let cover_path = Self::find_cover_path(&metadata_raw, &manifest, opf_dir);
        let mut cover_base64 = None;
        if let Some(path) = cover_path {
            if let Ok(data) = Self::read_zip_file(&mut archive, &path) {
                let ext = Path::new(&path).extension().and_then(|e| e.to_str()).unwrap_or("jpg");
                let mime = match ext {
                    "png" => "image/png",
                    "webp" => "image/webp",
                    _ => "image/jpeg",
                };
                cover_base64 = Some(format!("data:{};base64,{}", mime, base64::engine::general_purpose::STANDARD.encode(data)));
            }
        }

        // 6. Parse TOC (simplified)
        let toc = Vec::new(); // TODO: Implement TOC parsing

        let total_length = chapter_lengths.iter().sum();
        let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_millis() as i64;

        let metadata = LNMetadata {
            id: book_id.to_string(),
            title,
            author,
            cover: cover_base64,
            added_at: now,
            chapter_count: chapters.len(),
            stats: BookStats {
                chapter_lengths,
                total_length,
                block_maps: None,
            },
            toc,
            language,
            category_ids: Vec::new(),
        };

        Ok((metadata, chapters, images))
    }

    fn get_opf_path<R: Read + std::io::Seek>(archive: &mut ZipArchive<R>) -> Result<String> {
        let mut container_file = archive.by_name("META-INF/container.xml")?;
        let mut content = String::new();
        container_file.read_to_string(&mut content)?;

        let mut reader = Reader::from_str(&content);
        let mut buf = Vec::new();
        loop {
            match reader.read_event_into(&mut buf) {
                Ok(Event::Start(ref e)) if e.local_name().as_ref() == b"rootfile" => {
                    for attr in e.attributes().flatten() {
                        if attr.key.as_ref() == b"full-path" {
                            return Ok(attr.unescape_value()?.into_owned());
                        }
                    }
                }
                Ok(Event::Eof) => break,
                _ => (),
            }
            buf.clear();
        }
        Err(anyhow!("Could not find OPF file in container.xml"))
    }

    fn read_zip_file<R: Read + std::io::Seek>(archive: &mut ZipArchive<R>, path: &str) -> Result<Vec<u8>> {
        let mut file = archive.by_name(path).or_else(|_| {
            let path_lower = path.to_lowercase();
            let mut found_name = None;
            for i in 0..archive.len() {
                if let Ok(f) = archive.by_index(i) {
                    if f.name().to_lowercase() == path_lower {
                        found_name = Some(f.name().to_string());
                        break;
                    }
                }
            }
            if let Some(name) = found_name {
                archive.by_name(&name).map_err(anyhow::Error::from)
            } else {
                Err(anyhow!("File not found: {}", path))
            }
        })?;
        let mut buf = Vec::new();
        file.read_to_end(&mut buf)?;
        Ok(buf)
    }

    fn parse_opf(content: &str) -> Result<(HashMap<String, String>, HashMap<String, (String, String)>, Vec<String>)> {
        let mut metadata = HashMap::new();
        let mut manifest = HashMap::new();
        let mut spine = Vec::new();

        let mut reader = Reader::from_str(content);
        let mut buf = Vec::new();
        let mut in_metadata = false;
        let mut in_manifest = false;
        let mut in_spine = false;

        loop {
            match reader.read_event_into(&mut buf) {
                Ok(Event::Start(ref e)) => {
                    let name = e.local_name();
                    let name_ref = name.as_ref();
                    if name_ref == b"metadata" { in_metadata = true; }
                    else if name_ref == b"manifest" { in_manifest = true; }
                    else if name_ref == b"spine" { in_spine = true; }
                    else if in_metadata {
                        let tag_name = String::from_utf8_lossy(name_ref).into_owned();
                        let text = reader.read_text(e.name())?.into_owned();
                        metadata.insert(tag_name, text);
                    } else if in_manifest && name_ref == b"item" {
                        let mut id = String::new();
                        let mut href = String::new();
                        let mut media_type = String::new();
                        for attr in e.attributes().flatten() {
                            match attr.key.as_ref() {
                                b"id" => id = attr.unescape_value()?.into_owned(),
                                b"href" => href = attr.unescape_value()?.into_owned(),
                                b"media-type" => media_type = attr.unescape_value()?.into_owned(),
                                _ => (),
                            }
                        }
                        if !id.is_empty() {
                            manifest.insert(id, (href, media_type));
                        }
                    } else if in_spine && name_ref == b"itemref" {
                        for attr in e.attributes().flatten() {
                            if attr.key.as_ref() == b"idref" {
                                spine.push(attr.unescape_value()?.into_owned());
                            }
                        }
                    }
                }
                Ok(Event::End(ref e)) => {
                    let name = e.local_name();
                    let name_ref = name.as_ref();
                    if name_ref == b"metadata" { in_metadata = false; }
                    else if name_ref == b"manifest" { in_manifest = false; }
                    else if name_ref == b"spine" { in_spine = false; }
                }
                Ok(Event::Empty(ref e)) => {
                    let name = e.local_name();
                    let name_ref = name.as_ref();
                    if in_manifest && name_ref == b"item" {
                        let mut id = String::new();
                        let mut href = String::new();
                        let mut media_type = String::new();
                        for attr in e.attributes().flatten() {
                            match attr.key.as_ref() {
                                b"id" => id = attr.unescape_value()?.into_owned(),
                                b"href" => href = attr.unescape_value()?.into_owned(),
                                b"media-type" => media_type = attr.unescape_value()?.into_owned(),
                                _ => (),
                            }
                        }
                        if !id.is_empty() {
                            manifest.insert(id, (href, media_type));
                        }
                    } else if in_spine && name_ref == b"itemref" {
                        for attr in e.attributes().flatten() {
                            if attr.key.as_ref() == b"idref" {
                                spine.push(attr.unescape_value()?.into_owned());
                            }
                        }
                    } else if in_metadata && name_ref == b"meta" {
                        let mut name_attr = String::new();
                        let mut content_attr = String::new();
                        for attr in e.attributes().flatten() {
                            match attr.key.as_ref() {
                                b"name" => name_attr = attr.unescape_value()?.into_owned(),
                                b"content" => content_attr = attr.unescape_value()?.into_owned(),
                                _ => (),
                            }
                        }
                        if !name_attr.is_empty() {
                            metadata.insert(name_attr, content_attr);
                        }
                    }
                }
                Ok(Event::Eof) => break,
                _ => (),
            }
            buf.clear();
        }
        Ok((metadata, manifest, spine))
    }

    fn resolve_path(base_dir: &Path, relative_path: &str) -> String {
        let mut path = base_dir.to_path_buf();
        for component in relative_path.split('/') {
            if component == ".." {
                path.pop();
            } else if component != "." {
                path.push(component);
            }
        }
        path.to_string_lossy().to_string().replace('\\', "/")
    }

    fn process_chapter_html<R: Read + std::io::Seek>(html: &str, chapter_path: &str, archive: &mut ZipArchive<R>) -> Result<(String, HashMap<String, Vec<u8>>)> {
        let document = kuchiki::parse_html().one(html);
        let mut images = HashMap::new();
        let chapter_dir_str = Path::new(chapter_path).parent().unwrap_or(Path::new("")).to_string_lossy().to_string();
        let chapter_dir = Path::new(&chapter_dir_str);

        // Find all images
        for edge in document.inclusive_descendants() {
            if let Some(element) = edge.as_element() {
                let name = element.name.local.as_ref();
                if name == "img" || name == "image" {
                    let src_attr = if name == "img" { "src" } else { "xlink:href" };
                    let mut attrs = element.attributes.borrow_mut();
                    if let Some(src) = attrs.get(src_attr) {
                        if !src.starts_with("http") && !src.starts_with("data:") {
                            let full_img_path = Self::resolve_path(chapter_dir, src);
                            if let Ok(data) = Self::read_zip_file(archive, &full_img_path) {
                                images.insert(full_img_path.clone(), data);
                                attrs.insert("data-epub-src", full_img_path);
                                attrs.remove(src_attr);
                                attrs.remove("width");
                                attrs.remove("height");
                            }
                        }
                    }
                }
            }
        }

        let body_node = document.select_first("body").ok().or_else(|| document.select_first("html").ok());
        let mut processed_html = if let Some(body) = body_node {
            body.as_node().to_string()
        } else {
            document.to_string()
        };

        if processed_html.starts_with("<body") {
            if let Some(start) = processed_html.find('>') {
                processed_html = processed_html[start + 1..].to_string();
            }
            if processed_html.ends_with("</body>") {
                let len = processed_html.len();
                processed_html.truncate(len - 7);
            }
        }

        Ok((processed_html, images))
    }

    fn find_cover_path(metadata: &HashMap<String, String>, manifest: &HashMap<String, (String, String)>, opf_dir: &Path) -> Option<String> {
        if let Some(cover_id) = metadata.get("cover") {
            if let Some((href, _)) = manifest.get(cover_id) {
                return Some(Self::resolve_path(opf_dir, href));
            }
        }

        for (href, _) in manifest.values() {
            if href.to_lowercase().contains("cover") {
                return Some(Self::resolve_path(opf_dir, href));
            }
        }

        None
    }
}
