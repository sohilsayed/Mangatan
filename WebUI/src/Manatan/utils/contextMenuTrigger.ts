export const normalizeTextBoxContextMenuHotkeys = (hotkeys: any): string[] => {
    if (Array.isArray(hotkeys)) return hotkeys.filter(h => typeof h === 'string');
    if (typeof hotkeys === 'string') return [hotkeys];
    return [];
};

export const normalizeLegacyTextBoxContextMenuTrigger = (trigger: any): string => {
    if (typeof trigger === 'string') return trigger;
    return 'right-click'; // Default
};
