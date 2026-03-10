import { HttpMethod } from '@/lib/requests/client/RestClient';
import { requestManager } from '@/lib/requests/RequestManager';
import { WhisperSyncData } from '../reader/types/whisperSync';

export class WhisperSyncService {
    static async getWhisperSyncData(bookId: string): Promise<WhisperSyncData> {
        const response = await requestManager
            .getClient()
            .fetcher(`/api/novel/whisper-sync/${encodeURIComponent(bookId)}`);
        return await response.json();
    }

    static async updateWhisperSyncData(bookId: string, data: WhisperSyncData): Promise<void> {
        await requestManager.getClient().fetcher(`/api/novel/whisper-sync/${encodeURIComponent(bookId)}`, {
            httpMethod: HttpMethod.POST,
            data: { data },
        });
    }

    static async uploadFile(bookId: string, file: File): Promise<void> {
        const formData = new FormData();
        formData.append('file', file);
        await requestManager.getClient().fetcher(`/api/novel/whisper-sync/${encodeURIComponent(bookId)}/upload`, {
            httpMethod: HttpMethod.POST,
            data: formData,
        });
    }

    static getFileUrl(bookId: string, filename: string): string {
        const baseUrl = requestManager.getBaseUrl();
        return `${baseUrl}/api/novel/whisper-sync/${encodeURIComponent(bookId)}/file/${encodeURIComponent(filename)}`;
    }
}
