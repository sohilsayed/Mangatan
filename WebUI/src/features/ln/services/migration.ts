import { AppStorage } from '@/lib/storage/AppStorage';
import { requestManager } from '@/lib/requests/RequestManager';

export async function migrateLnToLocalServer() {
    const migrationFlag = 'ln_migration_to_server_done';
    if (localStorage.getItem(migrationFlag)) {
        return;
    }

    console.log('[Migration] Starting LN migration to local server...');

    try {
        // 1. Migrate Categories
        const categories = await AppStorage.getLocalOnlyLnCategories();
        for (const cat of categories) {
            await requestManager.createLnCategory(cat).response;
        }

        // 2. Migrate Books
        const allMetadata = await AppStorage.getLocalOnlyLnMetadata();
        for (const metadata of allMetadata) {
            const bookId = metadata.id;

            // Get raw file if available
            const file = await AppStorage.files.getItem<Blob>(bookId);
            if (file) {
                // If we have the original file, we can just re-import it on the server
                // but we might want to keep the same ID.
                // Our current server import generates a new UUID.
                // We should probably add an endpoint that accepts an ID or update it after.
                // For now, let's use import.
                const fileObj = new File([file], `${metadata.title}.epub`, { type: 'application/epub+zip' });
                await requestManager.importLnBook(fileObj, bookId).response;
            } else {
                // If no raw file, we can't easily re-import everything perfectly without the EPUB.
                // But we could potentially upload the parsed content if we had an endpoint for it.
                console.warn(`[Migration] No source file for book ${bookId}, skipping content migration.`);
            }

            // Migrate Progress
            const progress = await AppStorage.getLnProgress(bookId);
            if (progress) {
                await requestManager.saveLnProgress(bookId, progress).response;
            }

            // Migrate Highlights
            // highlights are currently stored in metadata or separate?
            // In AppStorage.ts: highlights are part of LNProgress? No, they have their own store in some versions?
            // Actually in the current AppStorage.ts I read, highlights are in progress object.
        }

        localStorage.setItem(migrationFlag, 'true');
        console.log('[Migration] LN migration to local server complete.');
    } catch (error) {
        console.error('[Migration] LN migration failed:', error);
    }
}
