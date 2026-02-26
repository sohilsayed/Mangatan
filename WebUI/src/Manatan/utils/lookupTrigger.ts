export const normalizeLookupTrigger = (trigger: any): string => {
    if (typeof trigger === 'string') return trigger;
    if (trigger && typeof trigger === 'object' && trigger.type) return trigger.type;
    return 'alt'; // Default
};
