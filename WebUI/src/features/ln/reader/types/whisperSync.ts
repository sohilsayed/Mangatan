export interface WhisperSyncTrack {
    id: string;
    audioFilename: string;
    subtitleFilename?: string;
    label: string;
    order: number;
}

export interface WhisperSyncMatch {
    trackId: string;
    subtitleIndex: number;
    blockId: string;
    startTime: number;
    endTime: number;
}

export interface WhisperSyncData {
    bookId: string;
    tracks: WhisperSyncTrack[];
    matches: WhisperSyncMatch[];
    lastModified: number;
}
