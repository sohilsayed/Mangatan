# Light Novel Reader Optimization Analysis

This document outlines the performance bottlenecks in the current Light Novel reader and provides a roadmap for optimizing chapter loading, specifically targeting the "initial load time" and "smooth transitions".

## Current Bottlenecks

### 1. IndexedDB Monolith (`AppStorage.ts`)
- **Issue**: The entire book (all chapters and image blobs) is stored as a single massive object in the `ln_content` store.
- **Impact**: Opening a 2.2MB EPUB requires loading the entire object into memory and de-serializing it, causing a multi-second "initial time" delay.

### 2. Upfront Image Processing (`useBookContent.ts`)
- **Issue**: The reader resolves image paths for every chapter and creates browser Object URLs (`blob:`) for *every* image in the book at startup.
- **Impact**: Significant CPU and memory usage during initialization, blocking the UI thread.

### 3. DOM Bloat (`ContinuousReader.tsx`)
- **Issue**: Every chapter in the book is rendered as a component simultaneously.
- **Impact**: Large books result in thousands of DOM nodes, slowing down re-renders and scroll tracking.

### 4. Layout Recalculation Lag (`PagedReader.tsx`)
- **Issue**: Changing chapters triggers a full browser reflow to calculate page counts, often waiting for images to load.
- **Impact**: Noticeable stutter when moving between chapters.

---

## Proposed Optimizations (Hints)

### 1. Migration to Rust Backend Storage (Primary Recommendation)
Move storage from the browser's IndexedDB to the native file system via the Rust backend.
- **Granular Storage**: Store chapters as individual `.html` files and images as separate files in the `data_dir`.
- **On-Demand API**: Implement `GET /api/ln/books/{id}/chapters/{index}` to fetch only the active chapter.
- **Native Image Serving**: Serve images via standard HTTP URLs. This allows the browser's networking stack to handle lazy loading, decoding, and caching natively.

### 2. Virtualization
- **Continuous Mode**: Implement a virtualized list (windowing) so that only chapters near the current scroll position are in the DOM.
- **Height Estimation**: Use the existing `chapterLengths` metadata to provide accurate scrollbar behavior for non-rendered chapters.

### 3. Image Dimension Extraction
- **Pre-measurement**: Extract image width/height during the EPUB import process.
- **Layout Stability**: Embed these dimensions in the HTML or metadata so the browser can reserve space immediately, making page count calculations O(1).

### 4. Layout Result Caching
- **Persistence**: Cache the `totalPages` result for each chapter, keyed by the current layout settings (font size, margins).
- **Instant Restoration**: Returning to a chapter becomes instant as the layout is already known.

### 5. Dual-Priority Loading
- **Immediate Fetch**: Prioritize the "target" chapter with a high-priority fetch.
- **Idle Pre-fetch**: Load adjacent chapters using `requestIdleCallback` or a low-priority background worker.
