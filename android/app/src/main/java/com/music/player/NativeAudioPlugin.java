package com.music.player;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "NativeAudio")
public class NativeAudioPlugin extends Plugin {
    private void command(String action, PluginCall call) {
        Intent intent = new Intent(getContext(), MusicService.class);
        intent.setAction(action);
        if (MusicService.ACTION_SEEK.equals(action)) {
            intent.putExtra("position", call.getLong("position", 0L));
        } else if (MusicService.ACTION_REPEAT.equals(action)) {
            intent.putExtra("mode", call.getInt("mode", 0));
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
                call.resolve(new JSObject().put("playing", false).put("position", 0).put("duration", 0).put("index", -1));
                return;
            }
            Bundle state = service.getPlaybackStateBundle();
            JSObject result = new JSObject();
            result.put("playing", state.getBoolean("playing"));
            result.put("position", state.getLong("position"));
            result.put("duration", state.getLong("duration"));
            result.put("index", state.getInt("index"));
            result.put("repeatMode", state.getInt("repeatMode"));
            result.put("error", state.getString("error"));
            call.resolve(result);
        });
    }
}
