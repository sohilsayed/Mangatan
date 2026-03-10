import React, { useState, useRef } from 'react';
import {
    Box,
    Typography,
    Button,
    List,
    ListItem,
    ListItemText,
    ListItemButton,
    IconButton,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    TextField,
    CircularProgress,
    Divider,
} from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import DeleteIcon from '@mui/icons-material/Delete';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import AddIcon from '@mui/icons-material/Add';
import SyncIcon from '@mui/icons-material/Sync';
import { WhisperSyncData, WhisperSyncTrack } from '../types/whisperSync';

interface WhisperSyncPanelProps {
    data: WhisperSyncData | null;
    loading: boolean;
    onUpdate: (newData: WhisperSyncData) => Promise<void>;
    onUpload: (file: File) => Promise<void>;
    onPlayTrack: (track: WhisperSyncTrack) => void;
    onOpenMatchUI: (track: WhisperSyncTrack) => void;
    theme: { bg: string; fg: string };
    bookId: string;
}

export const WhisperSyncPanel: React.FC<WhisperSyncPanelProps> = ({
    data,
    loading,
    onUpdate,
    onUpload,
    onPlayTrack,
    onOpenMatchUI,
    theme,
    bookId
}) => {
    const [uploading, setUploading] = useState(false);
    const [addTrackOpen, setAddTrackOpen] = useState(false);
    const [newTrack, setNewTrack] = useState<Partial<WhisperSyncTrack>>({ label: '', order: 0 });
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            setUploading(true);
            try {
                for (const file of Array.from(e.target.files)) {
                    await onUpload(file);
                }
            } finally {
                setUploading(false);
                if (fileInputRef.current) fileInputRef.current.value = '';
            }
        }
    };

    const handleAddTrack = async () => {
        if (!data || !newTrack.audioFilename) return;

        const track: WhisperSyncTrack = {
            id: `track_${Date.now()}`,
            audioFilename: newTrack.audioFilename,
            subtitleFilename: newTrack.subtitleFilename,
            label: newTrack.label || newTrack.audioFilename,
            order: newTrack.order || data.tracks.length,
        };

        const newData: WhisperSyncData = {
            ...data,
            tracks: [...data.tracks, track].sort((a, b) => a.order - b.order),
            lastModified: Date.now(),
        };

        await onUpdate(newData);
        setAddTrackOpen(false);
        setNewTrack({ label: '', order: 0 });
    };

    const handleDeleteTrack = async (trackId: string) => {
        if (!data) return;
        const newData: WhisperSyncData = {
            ...data,
            tracks: data.tracks.filter(t => t.id !== trackId),
            matches: data.matches.filter(m => m.trackId !== trackId),
            lastModified: Date.now(),
        };
        await onUpdate(newData);
    };

    if (loading) {
        return (
            <Box sx={{ p: 3, textAlign: 'center' }}>
                <CircularProgress size={24} sx={{ color: theme.fg }} />
            </Box>
        );
    }

    return (
        <Box sx={{ p: 2, display: 'flex', flexDirection: 'column', gap: 2, bgcolor: theme.bg, color: theme.fg }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="h6" sx={{ fontWeight: 600 }}>Audio Sync</Typography>
                <input
                    type="file"
                    multiple
                    style={{ display: 'none' }}
                    ref={fileInputRef}
                    onChange={handleFileChange}
                />
                <Button
                    variant="outlined"
                    size="small"
                    startIcon={uploading ? <CircularProgress size={16} /> : <CloudUploadIcon />}
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploading}
                    sx={{ color: theme.fg, borderColor: `${theme.fg}44`, textTransform: 'none' }}
                >
                    Upload Files
                </Button>
            </Box>

            <Divider sx={{ borderColor: `${theme.fg}22` }} />

            <Box>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                    <Typography variant="subtitle2">Tracks</Typography>
                    <IconButton size="small" onClick={() => setAddTrackOpen(true)} sx={{ color: theme.fg }}>
                        <AddIcon />
                    </IconButton>
                </Box>

                {data?.tracks.length === 0 ? (
                    <Typography variant="body2" sx={{ opacity: 0.6, py: 2, textAlign: 'center' }}>
                        No tracks added yet. Upload audio and subtitle files, then add them as a track.
                    </Typography>
                ) : (
                    <List sx={{ pt: 0 }}>
                        {data?.tracks.map((track) => (
                            <ListItem
                                key={track.id}
                                disablePadding
                                secondaryAction={
                                    <Box sx={{ display: 'flex', gap: 0.5 }}>
                                        <IconButton size="small" onClick={() => onOpenMatchUI(track)} sx={{ color: theme.fg, opacity: 0.7 }}>
                                            <SyncIcon fontSize="small" />
                                        </IconButton>
                                        <IconButton size="small" onClick={() => handleDeleteTrack(track.id)} sx={{ color: theme.fg, opacity: 0.5 }}>
                                            <DeleteIcon fontSize="small" />
                                        </IconButton>
                                    </Box>
                                }
                                sx={{ borderBottom: `1px solid ${theme.fg}11` }}
                            >
                                <ListItemButton onClick={() => onPlayTrack(track)} sx={{ py: 1 }}>
                                    <PlayArrowIcon sx={{ mr: 1, fontSize: 20, opacity: 0.7 }} />
                                    <ListItemText
                                        primary={track.label}
                                        secondary={track.audioFilename}
                                        primaryTypographyProps={{ fontSize: '0.85rem', fontWeight: 500 } as any}
                                        secondaryTypographyProps={{ fontSize: '0.7rem', sx: { opacity: 0.6 } } as any}
                                    />
                                </ListItemButton>
                            </ListItem>
                        ))}
                    </List>
                )}
            </Box>

            <Dialog
                open={addTrackOpen}
                onClose={() => setAddTrackOpen(false)}
                PaperProps={{ sx: { bgcolor: theme.bg, color: theme.fg, minWidth: 320 } }}
            >
                <DialogTitle>Add Audio Track</DialogTitle>
                <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 2, pt: 1 }}>
                    <TextField
                        fullWidth
                        label="Label"
                        size="small"
                        value={newTrack.label}
                        onChange={(e) => setNewTrack({ ...newTrack, label: e.target.value })}
                    />
                    <TextField
                        fullWidth
                        label="Audio Filename"
                        size="small"
                        value={newTrack.audioFilename}
                        onChange={(e) => setNewTrack({ ...newTrack, audioFilename: e.target.value })}
                        helperText="e.g., chapter1.mp3"
                    />
                    <TextField
                        fullWidth
                        label="Subtitle Filename (optional)"
                        size="small"
                        value={newTrack.subtitleFilename}
                        onChange={(e) => setNewTrack({ ...newTrack, subtitleFilename: e.target.value })}
                        helperText="e.g., chapter1.vtt"
                    />
                    <TextField
                        fullWidth
                        label="Order"
                        type="number"
                        size="small"
                        value={newTrack.order}
                        onChange={(e) => setNewTrack({ ...newTrack, order: parseInt(e.target.value, 10) })}
                    />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setAddTrackOpen(false)} sx={{ color: theme.fg }}>Cancel</Button>
                    <Button onClick={handleAddTrack} sx={{ color: theme.fg, fontWeight: 600 }}>Add</Button>
                </DialogActions>
            </Dialog>
        </Box>
    );
};
