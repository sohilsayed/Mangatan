import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';
import { useShallow } from 'zustand/react/shallow';
import { AppStorage, LNMetadata, LnCategory, LnCategoryMetadata } from '@/lib/storage/AppStorage';
import { LNCategoriesService } from '@/features/ln/services/LNCategories';
import { isNovelProgressComplete } from '@/features/ln/utils/progressStatus';
import { ZustandUtil } from '@/lib/zustand/ZustandUtil';

export interface LibraryItem extends LNMetadata {
    importProgress?: number;
    importMessage?: string;
    lastRead?: number;
    totalProgress?: number;
    isCompleted?: boolean;
}

interface LNLibraryState {
    allBooks: LibraryItem[];
    categories: LnCategory[];
    categoryMetadata: Record<string, LnCategoryMetadata>;
    selectedCategoryId: string;
    isImporting: boolean;
    isInitialized: boolean;
}

interface LNLibraryActions {
    initialize: () => Promise<void>;
    loadLibrary: () => Promise<void>;
    loadCategories: () => Promise<void>;
    setSelectedCategoryId: (categoryId: string) => void;
    updateCategoryMetadata: (categoryId: string, metadata: Partial<LnCategoryMetadata>) => Promise<void>;
    setAllBooks: (books: LibraryItem[]) => void;
    addBook: (book: LibraryItem) => void;
    updateBook: (id: string, updates: Partial<LibraryItem>) => void;
    removeBook: (id: string) => void;
    setIsImporting: (isImporting: boolean) => void;
    addCategory: (name: string) => Promise<void>;
}

export type LNLibraryStore = LNLibraryState & LNLibraryActions;

const createActionName = ZustandUtil.createActionNameCreator('lnLibrary');

export const useLNLibraryStoreBase = create<LNLibraryStore>()(
    devtools(
        immer((set, get) => ({
            allBooks: [],
            categories: [],
            categoryMetadata: {},
            selectedCategoryId: LNCategoriesService.getAllCategoryId(),
            isImporting: false,
            isInitialized: false,

            initialize: async () => {
                if (get().isInitialized) return;
                await AppStorage.migrateLnMetadata();
                await get().loadCategories();
                await get().loadLibrary();
                set({ isInitialized: true }, false, createActionName('initialize'));
            },

            loadLibrary: async () => {
                try {
                    const keys = await AppStorage.lnMetadata.keys();
                    const itemsPromises = keys.map(async (key) => {
                        const metadata = await AppStorage.lnMetadata.getItem<LNMetadata>(key);
                        if (!metadata) return null;

                        const progress = await AppStorage.lnProgress.getItem(key);
                        const isCompleted = isNovelProgressComplete(progress?.totalProgress);
                        return {
                            ...metadata,
                            hasProgress: !!progress && !isCompleted,
                            isCompleted,
                            lastRead: progress?.lastRead,
                            totalProgress: progress?.totalProgress,
                        } as LibraryItem;
                    });

                    const items = (await Promise.all(itemsPromises)).filter(
                        (item): item is LibraryItem => item !== null,
                    );
                    set({ allBooks: items }, false, createActionName('loadLibrary'));
                } catch (error) {
                    console.error('Failed to load library:', error);
                }
            },

            loadCategories: async () => {
                const categories = await LNCategoriesService.getCategories();
                const categoryMetadata = await LNCategoriesService.getAllCategoryMetadata();
                set({ categories, categoryMetadata }, false, createActionName('loadCategories'));
            },

            setSelectedCategoryId: (categoryId: string) => {
                set({ selectedCategoryId: categoryId }, false, createActionName('setSelectedCategoryId'));
            },

            updateCategoryMetadata: async (categoryId: string, metadata: Partial<LnCategoryMetadata>) => {
                const currentMetadata = get().categoryMetadata[categoryId] || { sortBy: 'dateAdded', sortDesc: true };
                const newMetadata = { ...currentMetadata, ...metadata };

                await LNCategoriesService.setCategoryMetadata(categoryId, newMetadata);

                set(
                    (draft) => {
                        draft.categoryMetadata[categoryId] = newMetadata;
                    },
                    false,
                    createActionName('updateCategoryMetadata'),
                );
            },

            setAllBooks: (books: LibraryItem[]) => {
                set({ allBooks: books }, false, createActionName('setAllBooks'));
            },

            addBook: (book: LibraryItem) => {
                set(
                    (draft) => {
                        draft.allBooks.unshift(book);
                    },
                    false,
                    createActionName('addBook'),
                );
            },

            updateBook: (id: string, updates: Partial<LibraryItem>) => {
                set(
                    (draft) => {
                        const index = draft.allBooks.findIndex((b) => b.id === id);
                        if (index !== -1) {
                            draft.allBooks[index] = { ...draft.allBooks[index], ...updates };
                        }
                    },
                    false,
                    createActionName('updateBook'),
                );
            },

            removeBook: (id: string) => {
                set(
                    (draft) => {
                        draft.allBooks = draft.allBooks.filter((b) => b.id !== id);
                    },
                    false,
                    createActionName('removeBook'),
                );
            },

            setIsImporting: (isImporting: boolean) => {
                set({ isImporting }, false, createActionName('setIsImporting'));
            },

            addCategory: async (name: string) => {
                await LNCategoriesService.createCategory(name);
                await get().loadCategories();
            },
        })),
        { name: 'LNLibraryStore' },
    ),
);

export const useLNLibraryStore = <T>(selector: (state: LNLibraryStore) => T): T =>
    useLNLibraryStoreBase(useShallow(selector));

export const getLNLibraryStore = () => useLNLibraryStoreBase.getState();

// Selectors
export const useFilteredAndSortedBooks = () => {
    const allBooks = useLNLibraryStore((state) => state.allBooks);
    const selectedCategoryId = useLNLibraryStore((state) => state.selectedCategoryId);
    const categoryMetadata = useLNLibraryStore((state) => state.categoryMetadata);

    const currentSort = categoryMetadata[selectedCategoryId] || { sortBy: 'dateAdded', sortDesc: true };

    let filtered = allBooks;
    if (!LNCategoriesService.isAllCategory(selectedCategoryId)) {
        filtered = allBooks.filter((book) => book.categoryIds?.includes(selectedCategoryId));
    }

    return [...filtered].sort((a, b) => {
        const multiplier = currentSort.sortDesc ? -1 : 1;
        switch (currentSort.sortBy) {
            case 'dateAdded':
                return multiplier * (b.addedAt - a.addedAt);
            case 'title':
                return multiplier * (a.title || '').localeCompare(b.title || '');
            case 'author':
                return multiplier * (a.author || '').localeCompare(b.author || '');
            case 'length':
                return multiplier * ((a.stats?.totalLength || 0) - (b.stats?.totalLength || 0));
            case 'language':
                return multiplier * ((a.language || 'unknown') > (b.language || 'unknown') ? 1 : -1);
            case 'lastRead':
                return multiplier * ((b.lastRead || 0) - (a.lastRead || 0));
            case 'progress':
                return multiplier * ((b.totalProgress || 0) - (a.totalProgress || 0));
            default:
                return multiplier * (b.addedAt - a.addedAt);
        }
    });
};
