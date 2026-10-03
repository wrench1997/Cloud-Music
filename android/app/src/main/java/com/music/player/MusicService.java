package com.music.player;

import android.content.Intent;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.media.app.NotificationCompat.MediaStyle;
import androidx.media3.common.MediaItem;
import androidx.media3.common.MediaMetadata;
import androidx.media3.common.Player;
import androidx.media3.common.PlaybackException;
import androidx.media3.datasource.DefaultDataSource;
import androidx.media3.datasource.DefaultHttpDataSource;
import androidx.media3.datasource.ResolvingDataSource;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory;
import androidx.media3.session.MediaSession;
import androidx.media3.session.MediaSessionService;
import java.util.ArrayList;
import java.util.List;
import java.util.HashMap;
import java.util.Map;
import org.json.JSONArray;
import org.json.JSONObject;

public class MusicService extends MediaSessionService {
    private static final String CHANNEL_ID = "yungan_playback";
    private static final int NOTIFICATION_ID = 2026;
    public static final String ACTION_QUEUE = "com.music.player.QUEUE";
    public static final String ACTION_PLAY = "com.music.player.PLAY";
    public static final String ACTION_PAUSE = "com.music.player.PAUSE";
    public static final String ACTION_STOP = "com.music.player.STOP";
    public static final String ACTION_SEEK = "com.music.player.SEEK";
    public static final String ACTION_REPEAT = "com.music.player.REPEAT";
    public static final String ACTION_NEXT = "com.music.player.NEXT";
    public static final String ACTION_PREVIOUS = "com.music.player.PREVIOUS";
    public static final String ACTION_VOLUME = "com.music.player.VOLUME";

    private static volatile MusicService instance;
    private ExoPlayer player;
    private MediaSession mediaSession;
    private String playbackError;

    public static MusicService getInstance() {
        return instance;
    }

    @Override
    public void onCreate() {
        super.onCreate();
        instance = this;
        DefaultDataSource.Factory dataSource = new DefaultDataSource.Factory(this, new DefaultHttpDataSource.Factory());
        ResolvingDataSource.Factory authorizedSource = new ResolvingDataSource.Factory(dataSource, dataSpec -> {
            if ("www.googleapis.com".equals(dataSpec.uri.getHost()) && dataSpec.uri.getPath() != null
                    && dataSpec.uri.getPath().startsWith("/drive/v3/files/")) {
                Map<String, String> headers = new HashMap<>(dataSpec.httpRequestHeaders);
                headers.put("Authorization", "Bearer " + GoogleDriveAuthPlugin.getPlaybackAccessToken(this));
                return dataSpec.withRequestHeaders(headers);
            }
            return dataSpec;
        });
        player = new ExoPlayer.Builder(this).setMediaSourceFactory(new DefaultMediaSourceFactory(authorizedSource)).build();
        player.setHandleAudioBecomingNoisy(true);
        mediaSession = new MediaSession.Builder(this, player).build();
        createNotificationChannel();
        player.addListener(new Player.Listener() {
            @Override
            public void onPlayerError(PlaybackException error) {
                playbackError = "播放失败，请检查网络、Google 授权或音频格式。";
            }
            @Override
            public void onIsPlayingChanged(boolean isPlaying) {
                if (player.getMediaItemCount() > 0) updateNotification();
            }

            @Override
            public void onMediaItemTransition(@Nullable MediaItem mediaItem, int reason) {
                if (mediaItem != null) updateNotification();
            }
        });
    }

    @Override
    public int onStartCommand(@Nullable Intent intent, int flags, int startId) {
        if (intent != null && intent.getAction() != null) {
            switch (intent.getAction()) {
                case ACTION_QUEUE:
                    loadQueue(intent.getStringExtra("tracks"), intent.getIntExtra("index", 0), intent.getLongExtra("position", 0));
                    break;
                case ACTION_PLAY:
                    player.play();
                    break;
                case ACTION_PAUSE:
                    player.pause();
                    break;
                case ACTION_STOP:
                    player.stop();
                    player.clearMediaItems();
                    stopForeground(STOP_FOREGROUND_REMOVE);
                    stopSelf();
                    break;
                case ACTION_SEEK:
                    player.seekTo(intent.getLongExtra("position", 0));
                    break;
                case ACTION_REPEAT:
                    player.setRepeatMode(intent.getIntExtra("mode", Player.REPEAT_MODE_OFF));
                    break;
                case ACTION_NEXT:
                    player.seekToNextMediaItem();
                    player.play();
                    break;
                case ACTION_PREVIOUS:
                    player.seekToPreviousMediaItem();
                    player.play();
                    break;
                case ACTION_VOLUME:
                    player.setVolume(Math.max(0f, Math.min(1f, intent.getFloatExtra("volume", 1f))));
                    break;
                default:
                    break;
            }
        }
        return super.onStartCommand(intent, flags, startId);
    }

    private void loadQueue(String json, int index, long position) {
        if (json == null) return;
        try {
            JSONArray array = new JSONArray(json);
            if (array.length() == 0) return;
            playbackError = null;
            List<MediaItem> items = new ArrayList<>();
            for (int i = 0; i < array.length(); i++) {
                JSONObject track = array.getJSONObject(i);
                MediaMetadata.Builder metadata = new MediaMetadata.Builder()
                    .setTitle(track.optString("title", "未知歌曲"))
                    .setArtist(track.optString("artist", "未知歌手"))
                    .setAlbumTitle(track.optString("album", ""));
                String cover = track.optString("cover", "");
                if (!cover.isEmpty()) metadata.setArtworkUri(Uri.parse(cover));
                items.add(new MediaItem.Builder()
                    .setMediaId(track.optString("id", String.valueOf(i)))
                    .setUri(track.getString("url"))
                    .setMediaMetadata(metadata.build())
                    .build());
            }
            player.setMediaItems(items, Math.max(0, Math.min(index, items.size() - 1)), Math.max(0, position));
            player.prepare();
            player.play();
            updateNotification();
        } catch (Exception ignored) {
        }
    }

    private PendingIntent serviceAction(String action, int requestCode) {
        Intent intent = new Intent(this, MusicService.class).setAction(action);
        return PendingIntent.getService(this, requestCode, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private void createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "音乐播放", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("云感音乐后台播放控制");
            channel.setShowBadge(false);
            getSystemService(NotificationManager.class).createNotificationChannel(channel);
        }
    }

    private void updateNotification() {
        MediaMetadata metadata = player.getMediaMetadata();
        Intent openIntent = new Intent(this, MainActivity.class);
        PendingIntent contentIntent = PendingIntent.getActivity(this, 10, openIntent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        int playIcon = player.isPlaying() ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play;
        String playAction = player.isPlaying() ? ACTION_PAUSE : ACTION_PLAY;
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_music_notification)
            .setContentTitle(metadata.title == null ? "云感音乐" : metadata.title)
            .setContentText(metadata.artist == null ? "正在播放" : metadata.artist)
            .setContentIntent(contentIntent)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOnlyAlertOnce(true)
            .setOngoing(player.isPlaying())
            .addAction(android.R.drawable.ic_media_previous, "上一首", serviceAction(ACTION_PREVIOUS, 11))
            .addAction(playIcon, player.isPlaying() ? "暂停" : "播放", serviceAction(playAction, 12))
            .addAction(android.R.drawable.ic_media_next, "下一首", serviceAction(ACTION_NEXT, 13))
            .setStyle(new MediaStyle().setShowActionsInCompactView(0, 1, 2));
        startForeground(NOTIFICATION_ID, builder.build());
    }

    public Bundle getPlaybackStateBundle() {
        Bundle result = new Bundle();
        result.putBoolean("playing", player.isPlaying());
        result.putLong("position", Math.max(0, player.getCurrentPosition()));
        result.putLong("duration", Math.max(0, player.getDuration()));
        result.putInt("index", player.getCurrentMediaItemIndex());
        result.putInt("repeatMode", player.getRepeatMode());
        result.putString("error", playbackError);
        return result;
    }

    @Override
    public MediaSession onGetSession(MediaSession.ControllerInfo controllerInfo) {
        return mediaSession;
    }

    @Override
    public void onTaskRemoved(Intent rootIntent) {
        if (!player.getPlayWhenReady()) stopSelf();
    }

    @Override
    public void onDestroy() {
        instance = null;
        mediaSession.release();
        player.release();
        super.onDestroy();
    }
}
