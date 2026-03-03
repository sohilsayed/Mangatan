import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
    NovelsReaderSettings,
    getDefaultNovelsSettings,
    getNovelsSettingsAsFullSettings,
    mergeWithDefaultNovelsSettings,
    normalizeNovelsSettingsLanguage,
    readLegacyNovelsSettingsFromLocalStorage,
    saveLegacyNovelsSettingsToLocalStorage,
} from '../utils/novelsSettings';
import { MANATAN_NOVELS_SETTINGS_META_KEY, getServerMetaJson, setServerMetaJson } from '@/Manatan/services/ServerMetaStorage.ts';

export function useNovelsSettings(language: string | undefined) {
    const effectiveLanguage = normalizeNovelsSettingsLanguage(language);
    const [settings, setSettingsState] = useState<NovelsReaderSettings>(() => getDefaultNovelsSettings());
    const settingsByLanguageRef = useRef<Record<string, NovelsReaderSettings>>({});
    const effectiveLanguageRef = useRef(effectiveLanguage);
    const hasLoadedInitialSettingsRef = useRef(false);
    const saveTimeoutRef = useRef<number | undefined>(undefined);

    useEffect(() => {
        effectiveLanguageRef.current = effectiveLanguage;
    }, [effectiveLanguage]);

    useEffect(() => {
        let cancelled = false;

        const loadSettings = async () => {
            const legacySettings = readLegacyNovelsSettingsFromLocalStorage();
            try {
                const serverSettingsRaw = await getServerMetaJson<Record<string, Partial<NovelsReaderSettings>> | null>(
                    MANATAN_NOVELS_SETTINGS_META_KEY,
                    null,
                );
                if (cancelled) {
                    return;
                }

                const serverSettings = Object.entries(serverSettingsRaw ?? {}).reduce<Record<string, NovelsReaderSettings>>(
                    (acc, [lang, langSettings]) => ({
                        ...acc,
                        [normalizeNovelsSettingsLanguage(lang)]: mergeWithDefaultNovelsSettings(langSettings),
                    }),
                    {},
                );

                const mergedSettings = { ...legacySettings, ...serverSettings };
                settingsByLanguageRef.current = mergedSettings;
                setSettingsState(mergedSettings[effectiveLanguageRef.current] ?? getDefaultNovelsSettings());
                hasLoadedInitialSettingsRef.current = true;

                const shouldMigrateLegacy = Object.keys(legacySettings).some((lang) => !serverSettings[lang]);
                if (shouldMigrateLegacy) {
                    await setServerMetaJson(MANATAN_NOVELS_SETTINGS_META_KEY, mergedSettings);
                }
            } catch (error) {
                console.error('[NovelsSettings] Failed to load settings from server metadata:', error);
                settingsByLanguageRef.current = legacySettings;
                setSettingsState(legacySettings[effectiveLanguageRef.current] ?? getDefaultNovelsSettings());
                hasLoadedInitialSettingsRef.current = true;
            }
        };

        loadSettings();

        return () => {
            cancelled = true;
            if (saveTimeoutRef.current !== undefined) {
                window.clearTimeout(saveTimeoutRef.current);
            }
        };
    }, []);

    useEffect(() => {
        if (!hasLoadedInitialSettingsRef.current) {
            return;
        }
        setSettingsState(settingsByLanguageRef.current[effectiveLanguage] ?? getDefaultNovelsSettings());
    }, [effectiveLanguage]);

    // Get settings as full Settings object for compatibility
    const fullSettings = useMemo(() => getNovelsSettingsAsFullSettings(settings), [settings]);

    const schedulePersist = useCallback((settingsByLanguage: Record<string, NovelsReaderSettings>) => {
        if (saveTimeoutRef.current !== undefined) {
            window.clearTimeout(saveTimeoutRef.current);
        }

        saveTimeoutRef.current = window.setTimeout(() => {
            setServerMetaJson(MANATAN_NOVELS_SETTINGS_META_KEY, settingsByLanguage).catch((error) => {
                console.error('[NovelsSettings] Failed to persist settings to server metadata:', error);
            });
        }, 300);

        // Keep legacy local cache in sync for backward compatibility and migration safety.
        saveLegacyNovelsSettingsToLocalStorage(settingsByLanguage);
    }, []);

    const saveLanguageSettings = useCallback((nextSettings: NovelsReaderSettings) => {
        const nextByLanguage = {
            ...settingsByLanguageRef.current,
            [effectiveLanguage]: nextSettings,
        };
        settingsByLanguageRef.current = nextByLanguage;

        if (hasLoadedInitialSettingsRef.current) {
            schedulePersist(nextByLanguage);
        }
    }, [effectiveLanguage, schedulePersist]);

    const setSettings = useCallback((updates: Partial<NovelsReaderSettings>) => {
        setSettingsState(prev => {
            const updated = { ...prev, ...updates };
            saveLanguageSettings(updated);
            return updated;
        });
    }, [saveLanguageSettings]);

    // Update a single setting
    const updateSetting = useCallback(<K extends keyof NovelsReaderSettings>(
        key: K,
        value: NovelsReaderSettings[K]
    ) => {
        setSettingsState(prev => {
            const updated = { ...prev, [key]: value };
            saveLanguageSettings(updated);
            return updated;
        });
    }, [saveLanguageSettings]);

    return {
        settings,
        setSettings,
        updateSetting,
        fullSettings,
        language: effectiveLanguage,
    };
}
