package com.music.player;

import static org.junit.Assert.*;
import org.junit.Test;

public class PlaybackPolicyTest {
    @Test public void initialUnknownPlayerDurationUsesPlaylistMetadataForSeeking() {
        // Media3 TIME_UNSET is negative until the Google Drive stream has been prepared.
        long duration = PlaybackPolicy.duration(-9223372036854775807L, 213000);
        assertEquals(213000, duration);
        assertEquals(106500, PlaybackPolicy.seekPosition(106500, duration));
        assertEquals(200000, PlaybackPolicy.duration(200000, 213000));
    }

    @Test public void seeksBeforeDurationDiscoveryRemainPendingInsteadOfJumpingToStart() {
        assertEquals(45000, PlaybackPolicy.seekPosition(45000, PlaybackPolicy.duration(-1, 0)));
        assertEquals(0, PlaybackPolicy.seekPosition(-200, 180000));
        assertEquals(180000, PlaybackPolicy.seekPosition(Long.MAX_VALUE, 180000));
        assertEquals(0, PlaybackPolicy.duration(-1, -500));
    }

    @Test public void playlistSecondsCannotOverflowOrProduceInvalidProgress() {
        assertEquals(213450, PlaybackPolicy.secondsToMillis(213.45));
        for (double value : new double[] { Double.NaN, Double.POSITIVE_INFINITY, Double.NEGATIVE_INFINITY, -1, Double.MAX_VALUE }) {
            assertEquals(0, PlaybackPolicy.secondsToMillis(value));
        }
    }

    @Test public void unsupportedRepeatModesFallBackToSequentialPlayback() {
        assertEquals(0, PlaybackPolicy.repeatMode(0));
        assertEquals(1, PlaybackPolicy.repeatMode(1));
        assertEquals(2, PlaybackPolicy.repeatMode(2));
        assertEquals(0, PlaybackPolicy.repeatMode(-1));
        assertEquals(0, PlaybackPolicy.repeatMode(3));
    }

    @Test public void aSavedSingleTrackOrSequentialModeCannotAlsoBeRandom() {
        assertFalse(PlaybackPolicy.shuffleEnabled(0, true));
        assertFalse(PlaybackPolicy.shuffleEnabled(1, true));
        assertTrue(PlaybackPolicy.shuffleEnabled(2, true));
        assertFalse(PlaybackPolicy.shuffleEnabled(2, false));
    }
}
