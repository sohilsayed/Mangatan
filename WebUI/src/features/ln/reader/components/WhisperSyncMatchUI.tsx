import React, { useState, useEffect, useMemo } from 'react';
import {
    Box,
    Typography,
    Button,
    List,
    ListItem,
    ListItemText,
    ListItemButton,
    IconButton,
    Paper,
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    CircularProgress,
    Divider,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import SaveIcon from '@mui/icons-material/Save';
import DeleteIcon from '@mui/icons-material/Delete';
import MinimizeIcon from '@mui/icons-material/Minimize';
import { WhisperSyncData, WhisperSyncTrack, WhisperSyncMatch } from '../types/whisperSync';

interface SubtitleLine {
    index: number;
    startTime: number;
    endTime: number;
    text: string;
}

interface WhisperSyncMatchUIProps {
    track: WhisperSyncTrack;
    data: WhisperSyncData;
    onUpdate: (newData: WhisperSyncData) => Promise<void>;
    onClose: () => void;
    theme: { bg: string; fg: string };
    getSubtitleFile: (filename: string) => Promise<string>;
    onSelectBlock: (onSelected: (blockId: string) => void) => void;
}

export const WhisperSyncMatchUI: React.FC<WhisperSyncMatchUIProps> = ({
    track,
    data,
    onUpdate,
    onClose,
    theme,
    getSubtitleFile,
    onSelectBlock
}) => {
    const [subtitles, setSubtitles] = useState<SubtitleLine[]>([]);
    const [loading, setLoading] = useState(true);
    const [currentIndex, setCurrentIndex] = useState(0);
    const [matches, setMatches] = useState<WhisperSyncMatch[]>([]);
    const [isMinimized, setIsMinimized] = useState(false);

    useEffect(() => {
        const loadSubtitles = async () => {
            if (!track.subtitleFilename) {
                setLoading(false);
                return;
            }

            try {
                const content = await getSubtitleFile(track.subtitleFilename);
                const lines = parseVTTorSRT(content);
                setSubtitles(lines);
                setMatches(data.matches.filter(m => m.trackId === track.id));
            } catch (e) {
                console.error('Failed to parse subtitle file:', e);
            } finally {
                setLoading(false);
            }
        };

        loadSubtitles();
    }, [track, data.matches, getSubtitleFile]);

    const parseVTTorSRT = (content: string): SubtitleLine[] => {
        const lines: SubtitleLine[] = [];
        const blocks = content.trim().split(/\n\s*\n/);

        let index = 0;
        for (const block of blocks) {
            const parts = block.trim().split('\n');
            if (parts.length < 2) continue;

            let timeLine = parts[0];
            let textStart = 1;

            if (/^\d+$/.test(parts[0])) {
                timeLine = parts[1];
                textStart = 2;
            }

            const timeMatch = timeLine.match(/(\d{2}:\d{2}:\d{2}[.,]\d{3}) --> (\d{2}:\d{2}:\d{2}[.,]\d{3})/);
            if (timeMatch) {
                const startTime = parseTime(timeMatch[1]);
                const endTime = parseTime(timeMatch[2]);
                const text = parts.slice(textStart).join(' ').replace(/<[^>]*>/g, '');

                lines.push({ index, startTime, endTime, text });
                index++;
            }
        }
        return lines;
    };

    const parseTime = (timeStr: string): number => {
        const parts = timeStr.replace(',', '.').split(':');
        const h = parseFloat(parts[0]);
        const m = parseFloat(parts[1]);
        const s = parseFloat(parts[2]);
        return h * 3600 + m * 60 + s;
    };

    const handleMatch = () => {
        onSelectBlock((blockId) => {
            const sub = subtitles[currentIndex];
            const newMatch: WhisperSyncMatch = {
                trackId: track.id,
                subtitleIndex: sub.index,
                blockId,
                startTime: sub.startTime,
                endTime: sub.endTime,
            };

            setMatches(prev => {
                const existing = prev.filter(m => m.subtitleIndex !== sub.index);
                return [...existing, newMatch].sort((a, b) => a.subtitleIndex - b.subtitleIndex);
            });

            if (currentIndex < subtitles.length - 1) {
                setCurrentIndex(currentIndex + 1);
            }
        });
    };

    const handleSave = async () => {
        const otherMatches = data.matches.filter(m => m.trackId !== track.id);
        const newData: WhisperSyncData = {
            ...data,
            matches: [...otherMatches, ...matches],
            lastModified: Date.now(),
        };
        await onUpdate(newData);
        onClose();
    };

    const handleClearMatch = (idx: number) => {
        setMatches(prev => prev.filter(m => m.subtitleIndex !== idx));
    };

    const currentMatch = useMemo(() => matches.find(m => m.subtitleIndex === currentIndex), [matches, currentIndex]);

    if (loading) {
        return (
            <Dialog open onClose={onClose} PaperProps={{ sx: { bgcolor: theme.bg, color: theme.fg } }}>
                <DialogContent sx={{ p: 4, textAlign: 'center' }}>
                    <CircularProgress color="inherit" />
                    <Typography sx={{ mt: 2 }}>Parsing subtitles...</Typography>
                </DialogContent>
            </Dialog>
        );
    }

    if (subtitles.length === 0) {
        return (
            <Dialog open onClose={onClose} PaperProps={{ sx: { bgcolor: theme.bg, color: theme.fg } }}>
                <DialogTitle>Error</DialogTitle>
                <DialogContent>
                    <Typography>No subtitle file found or parsing failed. Please upload a .vtt or .srt file.</Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={onClose} sx={{ color: theme.fg }}>Close</Button>
                </DialogActions>
            </Dialog>
        );
    }

    if (isMinimized) {
        return (
            <Paper
                elevation={4}
                sx={{
                    position: 'fixed',
                    bottom: 16,
                    right: 16,
                    width: 200,
                    p: 1.5,
                    bgcolor: theme.bg,
                    color: theme.fg,
                    borderRadius: 2,
                    zIndex: 2000,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    border: `1px solid ${theme.fg}22`,
                }}
            >
                <Typography variant="body2" sx={{ fontWeight: 600 }}>Matching...</Typography>
                <IconButton size="small" onClick={() => setIsMinimized(false)} sx={{ color: theme.fg }}><ArrowForwardIcon fontSize="small" /></IconButton>
            </Paper>
        );
    }

    return (
        <Paper
            elevation={4}
            sx={{
                position: 'fixed',
                top: 0,
                right: 0,
                width: 'min(400px, 90vw)',
                height: '100%',
                bgcolor: theme.bg,
                color: theme.fg,
                zIndex: 2000,
                display: 'flex',
                flexDirection: 'column',
                borderLeft: `1px solid ${theme.fg}22`,
            }}
        >
            <Box sx={{ p: 2, display: 'flex', alignItems: 'center', gap: 2, borderBottom: `1px solid ${theme.fg}22` } as any}>
                <IconButton onClick={onClose} sx={{ color: theme.fg }}><CloseIcon /></IconButton>
                <Typography variant="subtitle1" sx={{ flex: 1, fontWeight: 600, noWrap: true } as any}>Match Subtitles</Typography>
                <IconButton onClick={() => setIsMinimized(true)} sx={{ color: theme.fg }}><MinimizeIcon /></IconButton>
                <Button
                    variant="contained"
                    size="small"
                    startIcon={<SaveIcon />}
                    onClick={handleSave}
                    sx={{ bgcolor: theme.fg, color: theme.bg, '&:hover': { bgcolor: `${theme.fg}dd` } }}
                >
                    Save
                </Button>
            </Box>

            <Box sx={{ p: 2, flex: 1, display: 'flex', flexDirection: 'column', gap: 2, overflow: 'auto' }}>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, alignItems: 'center' }}>
                    <Typography variant="caption" sx={{ opacity: 0.6 }}>Subtitle {currentIndex + 1} of {subtitles.length}</Typography>

                    <Paper elevation={1} sx={{ p: 2, width: '100%', bgcolor: `${theme.fg}05`, color: theme.fg, textAlign: 'center' } as any}>
                        <Typography variant="body2" sx={{ fontWeight: 500 }}>{subtitles[currentIndex].text}</Typography>
                    </Paper>

                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <IconButton
                            size="small"
                            disabled={currentIndex === 0}
                            onClick={() => setCurrentIndex(currentIndex - 1)}
                            sx={{ color: theme.fg }}
                        >
                            <ArrowBackIcon />
                        </IconButton>

                        <Button
                            variant="outlined"
                            size="small"
                            onClick={handleMatch}
                            sx={{ color: theme.fg, borderColor: theme.fg }}
                        >
                            {currentMatch ? `Re-match` : 'Match to Text'}
                        </Button>

                        <IconButton
                            size="small"
                            disabled={currentIndex === subtitles.length - 1}
                            onClick={() => setCurrentIndex(currentIndex + 1)}
                            sx={{ color: theme.fg }}
                        >
                            <ArrowForwardIcon />
                        </IconButton>
                    </Box>
                    {currentMatch && (
                        <Typography variant="caption" sx={{ opacity: 0.7 }}>Matched to: {currentMatch.blockId}</Typography>
                    )}
                </Box>

                <Divider sx={{ my: 1, borderColor: `${theme.fg}11` }} />

                <Box sx={{ flex: 1 }}>
                    <Typography variant="caption" sx={{ mb: 1, fontWeight: 600, display: 'block' }}>Matched Lines ({matches.length})</Typography>
                    <List sx={{ pt: 0 }}>
                        {matches.map((match) => {
                            const sub = subtitles.find(s => s.index === match.subtitleIndex);
                            return (
                                <ListItem
                                    key={match.subtitleIndex}
                                    disablePadding
                                    secondaryAction={
                                        <IconButton size="small" onClick={(e) => { e.stopPropagation(); handleClearMatch(match.subtitleIndex); }} sx={{ color: theme.fg, opacity: 0.5 }}>
                                            <DeleteIcon fontSize="small" />
                                        </IconButton>
                                    }
                                    sx={{
                                        mb: 0.5,
                                        borderRadius: 1,
                                        bgcolor: currentIndex === match.subtitleIndex ? `${theme.fg}11` : 'transparent'
                                    }}
                                >
                                    <ListItemButton onClick={() => setCurrentIndex(match.subtitleIndex)} sx={{ py: 0.5, px: 1 }}>
                                        <ListItemText
                                            primary={sub?.text || `Line ${match.subtitleIndex}`}
                                            secondary={`Block: ${match.blockId}`}
                                            primaryTypographyProps={{ fontSize: '0.75rem', noWrap: true, sx: { opacity: 0.9 } as any } as any}
                                            secondaryTypographyProps={{ fontSize: '0.65rem', sx: { opacity: 0.6 } as any } as any}
                                        />
                                    </ListItemButton>
                                </ListItem>
                            );
                        })}
                    </List>
                </Box>
            </Box>
        </Paper>
    );
};
