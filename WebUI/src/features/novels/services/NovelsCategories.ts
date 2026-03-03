import { AppStorage, NovelsCategory, NovelsCategoryMetadata } from '@/lib/storage/AppStorage';

const DEFAULT_SORT: NovelsCategoryMetadata = {
    sortBy: 'dateAdded',
    sortDesc: true,
};

const ALL_CATEGORY_ID = '__all__';

export const NovelsSortMode = {
    DATE_ADDED: 'dateAdded',
    TITLE: 'title',
    AUTHOR: 'author',
    LENGTH: 'length',
    LANGUAGE: 'language',
    LAST_READ: 'lastRead',
    PROGRESS: 'progress',
} as const;

export type NovelsSortModeType = typeof NovelsSortMode[keyof typeof NovelsSortMode];

export class NovelsCategoriesService {
    static getAllCategoryId(): string {
        return ALL_CATEGORY_ID;
    }

    static isAllCategory(categoryId: string): boolean {
        return categoryId === ALL_CATEGORY_ID;
    }

    static async getCategories(): Promise<NovelsCategory[]> {
        return AppStorage.getNovelsCategories();
    }

    static async getCategory(categoryId: string): Promise<NovelsCategory | null> {
        if (this.isAllCategory(categoryId)) {
            return null;
        }
        return AppStorage.getNovelsCategory(categoryId);
    }

    static async createCategory(name: string): Promise<NovelsCategory> {
        return AppStorage.createNovelsCategory(name);
    }

    static async updateCategory(categoryId: string, updates: Partial<NovelsCategory>): Promise<void> {
        if (this.isAllCategory(categoryId)) {
            throw new Error('Cannot update All category');
        }
        return AppStorage.updateNovelsCategory(categoryId, updates);
    }

    static async deleteCategory(categoryId: string): Promise<void> {
        if (this.isAllCategory(categoryId)) {
            throw new Error('Cannot delete All category');
        }
        return AppStorage.deleteNovelsCategory(categoryId);
    }

    static async getCategoryMetadata(categoryId: string): Promise<NovelsCategoryMetadata> {
        if (this.isAllCategory(categoryId)) {
            const stored = await AppStorage.getNovelsCategoryMetadata(ALL_CATEGORY_ID);
            return stored || DEFAULT_SORT;
        }
        const stored = await AppStorage.getNovelsCategoryMetadata(categoryId);
        return stored || DEFAULT_SORT;
    }

    static async setCategoryMetadata(categoryId: string, metadata: NovelsCategoryMetadata): Promise<void> {
        return AppStorage.setNovelsCategoryMetadata(categoryId, metadata);
    }

    static async getAllCategoryMetadata(): Promise<Record<string, NovelsCategoryMetadata>> {
        return AppStorage.getAllNovelsCategoryMetadata();
    }

    static async setSortMode(
        categoryId: string,
        sortBy: NovelsSortModeType,
        sortDesc: boolean = true
    ): Promise<void> {
        return this.setCategoryMetadata(categoryId, { sortBy, sortDesc });
    }

    static compareFn(
        items: Array<{ metadata: any; progress?: any }>,
        sortBy: NovelsSortModeType,
        sortDesc: boolean
    ): number {
        const multiplier = sortDesc ? -1 : 1;

        switch (sortBy) {
            case NovelsSortMode.DATE_ADDED:
                return (a: any, b: any) => multiplier * (b.metadata.addedAt - a.metadata.addedAt);

            case NovelsSortMode.TITLE:
                return (a: any, b: any) =>
                    multiplier *
                    (a.metadata.title || '').localeCompare(b.metadata.title || '');

            case NovelsSortMode.AUTHOR:
                return (a: any, b: any) =>
                    multiplier *
                    (a.metadata.author || '').localeCompare(b.metadata.author || '');

            case NovelsSortMode.LENGTH:
                return (a: any, b: any) =>
                    multiplier *
                    ((b.metadata.stats?.totalLength || 0) - (a.metadata.stats?.totalLength || 0));

            case NovelsSortMode.LANGUAGE:
                return (a: any, b: any) =>
                    multiplier *
                    ((a.metadata.language || 'unknown') > (b.metadata.language || 'unknown')
                        ? 1
                        : -1);

            case NovelsSortMode.LAST_READ:
                return (a: any, b: any) =>
                    multiplier *
                    ((b.progress?.lastRead || 0) - (a.progress?.lastRead || 0));

            case NovelsSortMode.PROGRESS:
                return (a: any, b: any) =>
                    multiplier *
                    ((b.progress?.totalProgress || 0) - (a.progress?.totalProgress || 0));

            default:
                return (a: any, b: any) => multiplier * (b.metadata.addedAt - a.metadata.addedAt);
        }
    }
}
