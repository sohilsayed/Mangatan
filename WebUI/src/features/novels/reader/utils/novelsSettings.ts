import { Settings } from '@/Manatan/types';

export interface NovelsReaderSettings {
    // Basic display
    novelsFontSize: number;
    novelsLineHeight: number;
    novelsFontFamily: string;
    novelsTheme: 'light' | 'sepia' | 'dark' | 'black';
    novelsReadingDirection: 'horizontal' | 'vertical-rtl' | 'vertical-ltr';
    novelsPaginationMode: 'scroll' | 'paginated' | 'single-page';
    novelsPageWidth: number;
    novelsPageMargin: number;
    novelsEnableFurigana: boolean;
    novelsTextAlign: 'left' | 'center' | 'justify';
    novelsLetterSpacing: number;
    novelsParagraphSpacing: number;

    // Additional display settings
    novelsTextBrightness: number;
    novelsFontWeight: number;
    novelsSecondaryFontFamily: string;

    // Bookmark settings
    novelsAutoBookmark: boolean;
    novelsBookmarkDelay: number;
    novelsLockProgressBar: boolean;

    // Navigation settings
    novelsHideNavButtons: boolean;
    novelsEnableSwipe: boolean;
    novelsDragThreshold: number;

    // Click zones (paged mode)
    novelsEnableClickZones: boolean;
    novelsClickZoneSize: number;
    novelsClickZonePlacement: 'vertical' | 'horizontal';
    novelsClickZonePosition: 'full' | 'start' | 'center' | 'end';
    novelsClickZoneCoverage: number;

    // Animations & extras
    novelsDisableAnimations: boolean;
    novelsShowCharProgress: boolean;

    // Yomitan integration
    enableYomitan: boolean;
    interactionMode: 'hover' | 'click';
}

const DEFAULT_NOVELS_SETTINGS: NovelsReaderSettings = {
    // Basic display
    novelsFontSize: 18,
    novelsLineHeight: 1.8,
    novelsFontFamily: '"Noto Serif JP", serif',
    novelsTheme: 'dark',
    novelsReadingDirection: 'vertical-rtl',
    novelsPaginationMode: 'paginated',
    novelsPageWidth: 800,
    novelsPageMargin: 20,
    novelsEnableFurigana: true,
    novelsTextAlign: 'justify',
    novelsLetterSpacing: 0,
    novelsParagraphSpacing: 0,

    // Additional display settings
    novelsTextBrightness: 100,
    novelsFontWeight: 400,
    novelsSecondaryFontFamily: '',

    // Bookmark settings
    novelsAutoBookmark: true,
    novelsBookmarkDelay: 5,
    novelsLockProgressBar: false,

    // Navigation settings
    novelsHideNavButtons: false,
    novelsEnableSwipe: true,
    novelsDragThreshold: 10,

    // Click zones (paged mode)
    novelsEnableClickZones: true,
    novelsClickZoneSize: 10,
    novelsClickZonePlacement: 'vertical',
    novelsClickZonePosition: 'full',
    novelsClickZoneCoverage: 60,

    // Animations & extras
    novelsDisableAnimations: false,
    novelsShowCharProgress: false,

    // Yomitan integration
    enableYomitan: true,
    interactionMode: 'hover',
};

const LEGACY_STORAGE_KEY_PREFIX = 'novels_settings_';

function getLegacyStorageKey(language: string): string {
    // Normalize language: use 'default' for unknown/empty
    const normalized = (!language || language === 'unknown') ? 'default' : language.toLowerCase();
    return `${LEGACY_STORAGE_KEY_PREFIX}${normalized}`;
}

export function getDefaultNovelsSettings(): NovelsReaderSettings {
    return { ...DEFAULT_NOVELS_SETTINGS };
}

export function normalizeNovelsSettingsLanguage(language?: string): string {
    return (!language || language === 'unknown') ? 'default' : language.toLowerCase();
}

export function mergeWithDefaultNovelsSettings(settings?: Partial<NovelsReaderSettings> | null): NovelsReaderSettings {
    return {
        ...DEFAULT_NOVELS_SETTINGS,
        ...(settings ?? {}),
    };
}

export function readLegacyNovelsSettingsFromLocalStorage(): Record<string, NovelsReaderSettings> {
    if (typeof window === 'undefined') {
        return {};
    }

    const settingsByLanguage: Record<string, NovelsReaderSettings> = {};
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(LEGACY_STORAGE_KEY_PREFIX)) {
            const language = key.slice(LEGACY_STORAGE_KEY_PREFIX.length);
            if (language) {
                try {
                    const raw = localStorage.getItem(key);
                    if (raw) {
                        const parsed = JSON.parse(raw) as Partial<NovelsReaderSettings>;
                        settingsByLanguage[language] = mergeWithDefaultNovelsSettings(parsed);
                    }
                } catch (error) {
                    console.warn('[NovelsSettings] Failed to parse legacy settings from localStorage:', key, error);
                }
            }
        }
    }

    return settingsByLanguage;
}

export function saveLegacyNovelsSettingsToLocalStorage(settingsByLanguage: Record<string, NovelsReaderSettings>): void {
    if (typeof window === 'undefined') {
        return;
    }

    Object.entries(settingsByLanguage).forEach(([language, settings]) => {
        try {
            const key = getLegacyStorageKey(language);
            localStorage.setItem(key, JSON.stringify(settings));
        } catch (error) {
            console.warn('[NovelsSettings] Failed to cache legacy settings in localStorage:', language, error);
        }
    });
}

export function getNovelsSettingsAsFullSettings(novelsSettings: NovelsReaderSettings): Partial<Settings> {
    return {
        // Basic display
        novelsFontSize: novelsSettings.novelsFontSize,
        novelsLineHeight: novelsSettings.novelsLineHeight,
        novelsFontFamily: novelsSettings.novelsFontFamily,
        novelsTheme: novelsSettings.novelsTheme,
        novelsReadingDirection: novelsSettings.novelsReadingDirection,
        novelsPaginationMode: novelsSettings.novelsPaginationMode,
        novelsPageWidth: novelsSettings.novelsPageWidth,
        novelsPageMargin: novelsSettings.novelsPageMargin,
        novelsEnableFurigana: novelsSettings.novelsEnableFurigana,
        novelsTextAlign: novelsSettings.novelsTextAlign,
        novelsLetterSpacing: novelsSettings.novelsLetterSpacing,
        novelsParagraphSpacing: novelsSettings.novelsParagraphSpacing,

        // Additional display
        novelsTextBrightness: novelsSettings.novelsTextBrightness,
        novelsFontWeight: novelsSettings.novelsFontWeight,
        novelsSecondaryFontFamily: novelsSettings.novelsSecondaryFontFamily,

        // Bookmarks
        novelsAutoBookmark: novelsSettings.novelsAutoBookmark,
        novelsBookmarkDelay: novelsSettings.novelsBookmarkDelay,
        novelsLockProgressBar: novelsSettings.novelsLockProgressBar,

        // Navigation
        novelsHideNavButtons: novelsSettings.novelsHideNavButtons,
        novelsEnableSwipe: novelsSettings.novelsEnableSwipe,
        novelsDragThreshold: novelsSettings.novelsDragThreshold,

        // Click zones
        novelsEnableClickZones: novelsSettings.novelsEnableClickZones,
        novelsClickZoneSize: novelsSettings.novelsClickZoneSize,
        novelsClickZonePlacement: novelsSettings.novelsClickZonePlacement,
        novelsClickZonePosition: novelsSettings.novelsClickZonePosition,
        novelsClickZoneCoverage: novelsSettings.novelsClickZoneCoverage,

        // Animations & extras
        novelsDisableAnimations: novelsSettings.novelsDisableAnimations,
        novelsShowCharProgress: novelsSettings.novelsShowCharProgress,

        // Yomitan
        enableYomitan: novelsSettings.enableYomitan,
        interactionMode: novelsSettings.interactionMode,
    };
}
