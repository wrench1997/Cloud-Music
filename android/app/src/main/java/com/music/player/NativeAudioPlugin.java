package com.music.player;

import android.content.Intent;
import android.os.Bundle;
import android.os.Build;
import android.os.Environment;
import android.content.ContentValues;
import android.provider.MediaStore;
import android.net.Uri;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.IOException;
import java.net.HttpURLConnection;
import java.net.URL;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NativeAudio")
public class NativeAudioPlugin extends Plugin {
    @PluginMethod
    public void saveDriveSong(PluginCall call) {
        String id = call.getString("id", "");
        if (!id.matches("[A-Za-z0-9_-]+")) { call.reject("无效的音乐文件。"); return; }
        saveRemoteSong(call, "https://www.googleapis.com/drive/v3/files/" + id + "?alt=media&supportsAllDrives=true", true);
    }

    @PluginMethod
    public void saveMp3(PluginCall call) {
        String remoteUrl = call.getString("url", "");
        String token = call.getString("token", "");
        String fileName = call.getString("fileName", "");
        try {
            URL source = new URL(remoteUrl);
            if ((!source.getProtocol().equals("https") && !source.getProtocol().equals("http"))
                    || source.getUserInfo() != null || !source.getPath().matches("/files/[A-Za-z0-9_-]+/[^/]+")
                    || !token.matches("[a-f0-9]{48}") || !fileName.endsWith(".mp3")) {
                call.reject("无效的 MP3 下载服务链接。"); return;
            }
            call.getData().put("mimeType", "audio/mpeg");
            saveRemoteSong(call, remoteUrl, false);
        } catch (Exception error) { call.reject("无效的下载地址。"); }
    }

    private void saveRemoteSong(PluginCall call, String remoteUrl, boolean isGoogle) {
        String fileName = call.getString("fileName", "music.mp3").replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_");
        if (fileName.isEmpty() || fileName.length() > 240) {
            call.reject("无效的音乐文件。"); return;
        }
        new Thread(() -> {
            Uri target = null;
            File legacyTarget = null;
            HttpURLConnection connection = null;
            try {
                connection = (HttpURLConnection) new URL(remoteUrl).openConnection();
                connection.setConnectTimeout(30000);
                connection.setReadTimeout(60000);
                connection.setInstanceFollowRedirects(false);
                connection.setRequestProperty("Authorization", "Bearer " + (isGoogle ? GoogleDriveAuthPlugin.getPlaybackAccessToken(getContext()) : call.getString("token")));
                if (connection.getResponseCode() != 200) throw new IOException("服务器返回 " + connection.getResponseCode() + "，请检查授权或重新连接。");
                if (!isGoogle && !connection.getContentType().startsWith("audio/mpeg")) throw new IOException("下载服务没有返回 MP3 音频。");
                OutputStream output;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentValues values = new ContentValues();
                    values.put(MediaStore.Downloads.DISPLAY_NAME, fileName);
                    values.put(MediaStore.Downloads.MIME_TYPE, call.getString("mimeType", "application/octet-stream"));
                    values.put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Yungan Music");
                    values.put(MediaStore.Downloads.IS_PENDING, 1);
                    target = getContext().getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values);
                    if (target == null) throw new IOException("无法创建下载文件。");
                    output = getContext().getContentResolver().openOutputStream(target);
                } else {
                    File directory = getContext().getExternalFilesDir(Environment.DIRECTORY_MUSIC);
                    if (directory == null) throw new IOException("音乐存储目录不可用。");
                    legacyTarget = File.createTempFile("music-", "-" + fileName, directory);
                    output = new FileOutputStream(legacyTarget);
                }
                if (output == null) throw new IOException("无法打开下载文件。");
                try (OutputStream sink = output; InputStream input = connection.getInputStream()) {
                    byte[] buffer = new byte[65536];
                    int count;
                    while ((count = input.read(buffer)) != -1) sink.write(buffer, 0, count);
                }
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q && target != null) {
                    ContentValues completed = new ContentValues();
                    completed.put(MediaStore.Downloads.IS_PENDING, 0);
                    getContext().getContentResolver().update(target, completed, null, null);
                }
                call.resolve(new JSObject().put("message", "已保存原文件：" + fileName + (target != null ? "（下载 / Yungan Music）" : "（应用外部音乐目录，卸载时会删除）")));
            } catch (Exception error) {
                if (target != null) getContext().getContentResolver().delete(target, null, null);
                if (legacyTarget != null) legacyTarget.delete();
                call.reject("保存音乐失败：" + error.getMessage());
            } finally { if (connection != null) connection.disconnect(); }
        }, "DriveMusicDownload").start();
    }

    private void command(String action, PluginCall call) {
        Intent intent = new Intent(getContext(), MusicService.class);
        intent.setAction(action);
        if (MusicService.ACTION_SEEK.equals(action)) {
            intent.putExtra("position", call.getLong("position", 0L));
        } else if (MusicService.ACTION_REPEAT.equals(action)) {
            intent.putExtra("mode", call.getInt("mode", 0));
        } else if (MusicService.ACTION_SHUFFLE.equals(action)) {
            intent.putExtra("enabled", call.getBoolean("enabled", false));
        } else if (MusicService.ACTION_VOLUME.equals(action)) {
            intent.putExtra("volume", call.getFloat("volume", 1f));
        }
        getContext().startService(intent);
        call.resolve();
    }

    @PluginMethod
    public void setQueue(PluginCall call) {
        JSArray tracks = call.getArray("tracks");
        if (tracks == null) {
            call.reject("tracks is required");
            return;
        }
        Intent intent = new Intent(getContext(), MusicService.class);
        intent.setAction(MusicService.ACTION_QUEUE);
        intent.putExtra("tracks", tracks.toString());
        intent.putExtra("index", call.getInt("index", 0));
        intent.putExtra("position", call.getLong("position", 0L));
        getContext().startService(intent);
        call.resolve();
    }

    @PluginMethod
    public void play(PluginCall call) {
        command(MusicService.ACTION_PLAY, call);
    }

    @PluginMethod
    public void pause(PluginCall call) {
        command(MusicService.ACTION_PAUSE, call);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        command(MusicService.ACTION_STOP, call);
    }

    @PluginMethod
    public void seekTo(PluginCall call) {
        command(MusicService.ACTION_SEEK, call);
    }

    @PluginMethod
    public void setRepeatMode(PluginCall call) {
        command(MusicService.ACTION_REPEAT, call);
    }

    @PluginMethod
    public void setShuffleMode(PluginCall call) {
        command(MusicService.ACTION_SHUFFLE, call);
    }

    @PluginMethod
    public void next(PluginCall call) {
        command(MusicService.ACTION_NEXT, call);
    }

    @PluginMethod
    public void previous(PluginCall call) {
        command(MusicService.ACTION_PREVIOUS, call);
    }

    @PluginMethod
    public void setVolume(PluginCall call) {
        command(MusicService.ACTION_VOLUME, call);
    }

    @PluginMethod
    public void getState(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            MusicService service = MusicService.getInstance();
            if (service == null) {
                Bundle saved = MusicService.getSavedPlaybackMode(getContext());
                call.resolve(new JSObject().put("playing", false).put("playWhenReady", false)
                    .put("buffering", false).put("ended", false).put("seekable", false)
                    .put("position", 0).put("duration", 0).put("bufferedPosition", 0).put("index", -1)
                    .put("repeatMode", saved.getInt("repeatMode")).put("shuffleEnabled", saved.getBoolean("shuffleEnabled")));
                return;
            }
            Bundle state = service.getPlaybackStateBundle();
            JSObject result = new JSObject();
            result.put("playing", state.getBoolean("playing"));
            result.put("playWhenReady", state.getBoolean("playWhenReady"));
            result.put("buffering", state.getBoolean("buffering"));
            result.put("ended", state.getBoolean("ended"));
            result.put("seekable", state.getBoolean("seekable"));
            result.put("position", state.getLong("position"));
            result.put("duration", state.getLong("duration"));
            result.put("bufferedPosition", state.getLong("bufferedPosition"));
            result.put("index", state.getInt("index"));
            result.put("repeatMode", state.getInt("repeatMode"));
            result.put("shuffleEnabled", state.getBoolean("shuffleEnabled"));
            result.put("error", state.getString("error"));
            call.resolve(result);
        });
    }
}
