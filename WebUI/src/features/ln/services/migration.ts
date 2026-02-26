import { AppStorage } from '@/lib/storage/AppStorage';
import { requestManager } from '@/lib/requests/RequestManager';

const MIGRATED_BOOKS_KEY = 'ln_migrated_books_ids';

function getMigratedIds(): Set<string> {
    const stored = localStorage.getItem(MIGRATED_BOOKS_KEY);
    return new Set(stored ? JSON.parse(stored) : []);
}

function addMigratedId(id: string) {
    const ids = getMigratedIds();
    ids.add(id);
    localStorage.setItem(MIGRATED_BOOKS_KEY, JSON.stringify(Array.from(ids)));
}

export async function migrateLnToLocalServer() {
    const migrationStartedFlag = 'ln_migration_to_server_started';
    const migrationDoneFlag = 'ln_migration_to_server_done';

    if (localStorage.getItem(migrationDoneFlag)) {
        return;
    }

    console.log('[Migration] Starting LN migration to local server...');
    localStorage.setItem(migrationStartedFlag, 'true');

    try {
        // 1. Migrate Categories (only once)
        const categoriesMigratedKey = 'ln_categories_migrated';
        if (!localStorage.getItem(categoriesMigratedKey)) {
            const categories = await AppStorage.getLocalOnlyLnCategories();
            console.log(`[Migration] Found ${categories.length} categories to migrate.`);
            for (const cat of categories) {
                try {
                    await requestManager.createLnCategory(cat).response;
                    // Also migrate category metadata (sort settings)
                    const meta = await AppStorage.lnCategoryMetadata.getItem<any>(cat.id);
                    if (meta) {
                        await requestManager.saveLnCategoryMetadata(cat.id, meta).response;
                    }
                } catch (e) {
                    console.error(`[Migration] Failed to migrate category ${cat.name}:`, e);
                }
            }
            localStorage.setItem(categoriesMigratedKey, 'true');
        }

        // 2. Migrate Books
        const allMetadata = await AppStorage.getLocalOnlyLnMetadata();
        const migratedIds = getMigratedIds();

        console.log(`[Migration] Found ${allMetadata.length} books. ${migratedIds.size} already migrated.`);

        for (const metadata of allMetadata) {
            const bookId = metadata.id;
            if (migratedIds.has(bookId)) continue;

            console.log(`[Migration] Migrating book: ${metadata.title} (${bookId})`);

            try {
                // Get raw file
                const file = await AppStorage.files.getItem<Blob>(bookId);
                if (file) {
                    const fileObj = new File([file], `${metadata.title}.epub`, { type: 'application/epub+zip' });
                    await requestManager.importLnBook(fileObj, bookId).response;

                    // 1. Migrate Metadata (to preserve languageSettings, categoryIds, etc.)
                    const metadataFromServer = await requestManager.useGetLnBook(bookId).refetch();
                    if (metadataFromServer.data) {
                        const mergedMetadata = {
                            ...metadataFromServer.data,
                            language: metadata.language || metadataFromServer.data.language,
                            categoryIds: metadata.categoryIds || (metadata as any).category_ids || [],
                            languageSettings: metadata.languageSettings || (metadata as any).language_settings || {},
                        };
                        await requestManager.updateLnBook(bookId, mergedMetadata).response;
                    }

                    // 2. Migrate Progress & Highlights
                    const progress = await AppStorage.getLnProgress(bookId);
                    if (progress) {
                        await requestManager.saveLnProgress(bookId, progress).response;
                    }

                    addMigratedId(bookId);
                    console.log(`[Migration] Successfully migrated book: ${metadata.title}`);
                } else {
                    console.warn(`[Migration] No source file for book ${metadata.title} (${bookId}). Attempting to migrate metadata/progress only.`);
                    // Even if content is missing, we might want to preserve metadata/progress in case of re-import
                    // But our server API doesn't support metadata-only creation easily without parsing.
                    // For now, we'll mark it as failed or skipped.
                }
            } catch (error) {
                console.error(`[Migration] Failed to migrate book ${metadata.title}:`, error);
            }
        }

        // Check if all books are migrated
        const remainingCount = allMetadata.filter(m => !getMigratedIds().has(m.id)).length;
        if (remainingCount === 0) {
            localStorage.setItem(migrationDoneFlag, 'true');
            console.log('[Migration] All LN data migrated to local server.');
        } else {
            console.warn(`[Migration] ${remainingCount} books failed to migrate. Will retry on next start.`);
        }

    } catch (error) {
        console.error('[Migration] Critical failure during LN migration:', error);
    }
}
