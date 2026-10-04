package com.music.player;

/** Validates UI positions while ExoPlayer is still discovering an audio file's duration. */
final class PlaybackPolicy {
    private PlaybackPolicy() {}

    static int repeatMode(int mode) {
        return mode >= 0 && mode <= 2 ? mode : 0;
    }

    static boolean shuffleEnabled(int repeatMode, boolean requested) {
        return repeatMode == 2 && requested;
    }

    static long duration(long playerDuration, long metadataDuration) {
        return playerDuration > 0 ? playerDuration : Math.max(0, metadataDuration);
    }

    static long secondsToMillis(double seconds) {
        if (!Double.isFinite(seconds) || seconds <= 0 || seconds > Long.MAX_VALUE / 1000d) return 0;
        return Math.round(seconds * 1000d);
    }

    static long seekPosition(long requestedPosition, long duration) {
        long position = Math.max(0, requestedPosition);
        // An unknown duration must not turn a valid pre-buffering seek into a jump to zero.
        return duration > 0 ? Math.min(position, duration) : position;
    }
}
