import { useState, useEffect, useCallback } from 'react';
import { WhisperSyncData } from '../types/whisperSync';
import { WhisperSyncService } from '../../services/WhisperSyncService';

export function useWhisperSync(bookId: string) {
    const [data, setData] = useState<WhisperSyncData | null>(null);
    const [loading, setLoading] = useState(true);

    const refresh = useCallback(async () => {
        try {
            const wsData = await WhisperSyncService.getWhisperSyncData(bookId);
            setData(wsData);
        } catch (e) {
            console.error('Failed to load whisper sync data:', e);
        } finally {
            setLoading(false);
        }
    }, [bookId]);

    useEffect(() => {
        refresh();
    }, [refresh]);

    const updateData = useCallback(async (newData: WhisperSyncData) => {
        await WhisperSyncService.updateWhisperSyncData(bookId, newData);
        setData(newData);
    }, [bookId]);

    const uploadFile = useCallback(async (file: File) => {
        await WhisperSyncService.uploadFile(bookId, file);
    }, [bookId]);

    const getFileUrl = useCallback((filename: string) => {
        return WhisperSyncService.getFileUrl(bookId, filename);
    }, [bookId]);

    return {
        data,
        loading,
        refresh,
        updateData,
        uploadFile,
        getFileUrl
    };
}
