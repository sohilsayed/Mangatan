import React, { useState, useEffect } from 'react';
import {
    Box,
    IconButton,
    Typography,
    Slider,
    Paper,
    Menu,
    MenuItem,
    Button,
} from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import SkipNextIcon from '@mui/icons-material/SkipNext';
import SkipPreviousIcon from '@mui/icons-material/SkipPrevious';
import SpeedIcon from '@mui/icons-material/Speed';
import CloseIcon from '@mui/icons-material/Close';

interface WhisperSyncPlayerProps {
    src: string;
    onTimeUpdate: (currentTime: number) => void;
    onClose: () => void;
    isPlaying: boolean;
    onTogglePlay: () => void;
    audioRef: React.MutableRefObject<HTMLAudioElement | null>;
    theme: { bg: string; fg: string };
    label?: string;
    activeTrackLabel?: string;
}

export const WhisperSyncPlayer: React.FC<WhisperSyncPlayerProps> = ({
    src,
    onTimeUpdate,
    onClose,
    isPlaying,
    onTogglePlay,
    audioRef,
    theme,
    label,
    activeTrackLabel
}) => {
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [playbackSpeed, setPlaybackSpeed] = useState(1);
    const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

    const handleTimeUpdate = () => {
        if (audioRef.current) {
            const time = audioRef.current.currentTime;
            setCurrentTime(time);
            onTimeUpdate(time);
        }
    };

    const handleLoadedMetadata = () => {
        if (audioRef.current) {
            setDuration(audioRef.current.duration);
        }
    };

    const togglePlay = () => {
        if (audioRef.current) {
            if (isPlaying) {
                audioRef.current.pause();
            } else {
                audioRef.current.play();
            }
        }
    };

    const handleSliderChange = (_: any, newValue: number | number[]) => {
        const time = newValue as number;
        if (audioRef.current) {
            audioRef.current.currentTime = time;
            setCurrentTime(time);
        }
    };

    const handleSpeedChange = (speed: number) => {
        setPlaybackSpeed(speed);
        if (audioRef.current) {
            audioRef.current.playbackRate = speed;
        }
        setAnchorEl(null);
    };

    const formatTime = (time: number) => {
        const mins = Math.floor(time / 60);
        const secs = Math.floor(time % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    };

    useEffect(() => {
        if (audioRef.current) {
            const wasPlaying = isPlaying;
            audioRef.current.src = src;
            audioRef.current.playbackRate = playbackSpeed;
            audioRef.current.load(); // Ensure source is loaded on mobile
            if (wasPlaying) {
                audioRef.current.play().catch(e => {
                    console.warn('Auto-play blocked by browser. User interaction required:', e);
                });
            }
        }
    }, [src]);

    useEffect(() => {
        if ('mediaSession' in navigator && activeTrackLabel) {
            navigator.mediaSession.metadata = new MediaMetadata({
                title: activeTrackLabel,
                artist: 'Light Novel Audiobook',
                album: label || 'Whisper Sync',
            });

            navigator.mediaSession.setActionHandler('play', () => {
                audioRef.current?.play();
            });
            navigator.mediaSession.setActionHandler('pause', () => {
                audioRef.current?.pause();
            });
            navigator.mediaSession.setActionHandler('seekbackward', () => {
                if (audioRef.current) audioRef.current.currentTime -= 10;
            });
            navigator.mediaSession.setActionHandler('seekforward', () => {
                if (audioRef.current) audioRef.current.currentTime += 30;
            });
        }
    }, [label, activeTrackLabel]);

    return (
        <Paper
            elevation={4}
            sx={{
                position: 'fixed',
                bottom: 16,
                left: '50%',
                transform: 'translateX(-50%)',
                width: 'min(500px, 90vw)',
                p: 1.5,
                bgcolor: theme.bg,
                color: theme.fg,
                borderRadius: 3,
                zIndex: 1000,
                display: 'flex',
                flexDirection: 'column',
                gap: 0.5,
                border: `1px solid ${theme.fg}22`,
            }}
        >
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography variant="caption" sx={{ opacity: 0.8, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1, mr: 1 }}>
                    {label || 'Audiobook'}
                </Typography>
                <IconButton size="small" onClick={onClose} sx={{ color: theme.fg, opacity: 0.6 }}>
                    <CloseIcon fontSize="small" />
                </IconButton>
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography variant="caption" sx={{ minWidth: 35 }}>{formatTime(currentTime)}</Typography>
                <Slider
                    size="small"
                    value={currentTime}
                    max={duration}
                    onChange={handleSliderChange}
                    sx={{
                        color: theme.fg,
                        '& .MuiSlider-thumb': { width: 12, height: 12 },
                        '& .MuiSlider-rail': { opacity: 0.2 }
                    }}
                />
                <Typography variant="caption" sx={{ minWidth: 35 }}>{formatTime(duration)}</Typography>
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2 }}>
                <IconButton onClick={() => { if (audioRef.current) audioRef.current.currentTime -= 10 }} sx={{ color: theme.fg, p: 1.5 }}>
                    <SkipPreviousIcon />
                </IconButton>
                <IconButton onClick={togglePlay} sx={{ color: theme.fg, bgcolor: `${theme.fg}11`, p: 2 }}>
                    {isPlaying ? <PauseIcon fontSize="large" /> : <PlayArrowIcon fontSize="large" />}
                </IconButton>
                <IconButton onClick={() => { if (audioRef.current) audioRef.current.currentTime += 30 }} sx={{ color: theme.fg, p: 1.5 }}>
                    <SkipNextIcon />
                </IconButton>
                <Box sx={{ flex: 1 }} />
                <Button
                    size="small"
                    onClick={(e) => setAnchorEl(e.currentTarget)}
                    startIcon={<SpeedIcon />}
                    sx={{ color: theme.fg, textTransform: 'none', fontSize: '0.75rem' }}
                >
                    {playbackSpeed}x
                </Button>
            </Box>

            <Menu
                anchorEl={anchorEl}
                open={Boolean(anchorEl)}
                onClose={() => setAnchorEl(null)}
                PaperProps={{ sx: { bgcolor: theme.bg, color: theme.fg } }}
            >
                {[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((s) => (
                    <MenuItem key={s} onClick={() => handleSpeedChange(s)} selected={playbackSpeed === s}>
                        {s}x
                    </MenuItem>
                ))}
            </Menu>

            <audio
                ref={audioRef}
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={handleLoadedMetadata}
                onPlay={() => { if (!isPlaying) onTogglePlay(); }}
                onPause={() => { if (isPlaying) onTogglePlay(); }}
                onEnded={() => { if (isPlaying) onTogglePlay(); }}
            />
        </Paper>
    );
};
