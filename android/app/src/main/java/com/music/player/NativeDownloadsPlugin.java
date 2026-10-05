package com.music.player;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import org.json.JSONArray;
import org.json.JSONObject;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "NativeDownloads")
public class NativeDownloadsPlugin extends Plugin implements NativeDownloadsManager.Listener {
    private final ExecutorService requests = Executors.newFixedThreadPool(2);
    private NativeDownloadsManager manager;
    @Override public void load() {
        try { manager = NativeDownloadsManager.get(getContext()); manager.addListener(this); }
        catch (Exception ignored) { /* Each call below reports initialization failures without losing login state. */ }
    }
    @Override protected void handleOnDestroy() {
        if (manager != null) manager.removeListener(this); requests.shutdownNow(); super.handleOnDestroy();
    }
    private interface Work { JSONObject run() throws Exception; }
    private void execute(PluginCall call, Work work) {
        requests.execute(() -> {
            try { if (manager == null) manager = NativeDownloadsManager.get(getContext()); call.resolve(new JSObject(work.run().toString())); }
            catch (Exception error) { call.reject(NativeDownloadRunner.message(error), "NATIVE_DOWNLOAD_FAILED", error); }
        });
    }
    @PluginMethod public void request(PluginCall call) {
        String route = call.getString("route", ""), method = call.getString("method", "GET");
        execute(call, () -> manager.request(route, method, call.getObject("data", new JSObject())));
    }
    @PluginMethod public void getFile(PluginCall call) { execute(call, () -> manager.getFile(call.getString("jobId", ""), call.getString("fileName", ""))); }
    @PluginMethod public void saveFile(PluginCall call) { execute(call, () -> manager.saveFile(call.getString("jobId", ""), call.getString("fileName", ""))); }
    @PluginMethod public void listLibrary(PluginCall call) { execute(call, () -> new JSONObject().put("songs", manager.library())); }
    @Override public void job(JSONObject job) {
        try { notifyListeners("jobChanged", new JSObject().put("job", new JSObject(job.toString()))); } catch (Exception ignored) {}
    }
    @Override public void library(JSONArray songs) {
        try { notifyListeners("libraryChanged", new JSObject().put("songs", new JSArray(songs.toString()))); } catch (Exception ignored) {}
    }
}
