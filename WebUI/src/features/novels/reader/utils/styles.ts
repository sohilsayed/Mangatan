import { Settings } from '@/Manatan/types';
import { CSSProperties } from 'react';

export function buildTypographyStyles(settings: Settings, isVertical: boolean): CSSProperties {
    const textAlign = (settings.novelsTextAlign as any) || 'justify';
    const fontWeight = settings.novelsFontWeight || 400;
    
    // Build font family with secondary font
    let fontFamily = settings.novelsFontFamily || "'Noto Serif JP', serif";
    if (settings.novelsSecondaryFontFamily) {
        fontFamily = `${fontFamily}, ${settings.novelsSecondaryFontFamily}`;
    }
    
    return {
        fontFamily,
        fontSize: `${settings.novelsFontSize || 18}px`,
        fontWeight,
        lineHeight: settings.novelsLineHeight || 1.8,
        letterSpacing: `${settings.novelsLetterSpacing || 0}px`,
        textAlign: textAlign,
        textAlignLast: textAlign === 'justify' ? 'start' : textAlign,
        writingMode: isVertical ? 'vertical-rl' : 'horizontal-tb',
        textOrientation: isVertical ? 'mixed' : undefined,
    };
}

export function buildContainerStyles(
    settings: Settings,
    isVertical: boolean,
    isRTL: boolean
): CSSProperties {
    return {
        ...buildTypographyStyles(settings, isVertical),
        direction: isVertical ? (isRTL ? 'rtl' : 'ltr') : 'ltr',
        scrollBehavior: isVertical ? 'auto' : 'smooth',
    };
}