package com.music.player;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.webkit.CookieManager;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.ActivityCallback;
import org.json.JSONArray;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
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
    @PluginMethod public void youtubeStatus(PluginCall call) { execute(call, () -> manager.youtubeStatus()); }
    @PluginMethod public void youtubeClear(PluginCall call) { execute(call, () -> manager.youtubeClear()); }
    @PluginMethod public void youtubeUsePreview(PluginCall call) {
        connectYoutubeCookies(call, "preview");
    }
    private void connectYoutubeCookies(PluginCall call, String source) {
        getActivity().runOnUiThread(() -> {
            CookieManager cookies = CookieManager.getInstance();
            String youtube = cookies.getCookie("https://www.youtube.com/"), music = cookies.getCookie("https://music.youtube.com/"), mobile = cookies.getCookie("https://m.youtube.com/");
            execute(call, () -> {
                String text;
                try { text = NativeYoutubeCookies.fromHeaders(youtube, music, mobile); }
                catch (IOException error) { throw new IOException("没有检测到应用内的 YouTube 登录，请点击“登录 YouTube 并接入下载”，或导入浏览器登录文件。"); }
                return manager.youtubeConfigure(text, source);
            });
        });
    }
    @PluginMethod public void youtubeSignIn(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            try { startActivityForResult(call, new Intent(getActivity(), NativeYoutubeLoginActivity.class), "youtubeLoginFinished"); }
            catch (Exception error) { call.reject("无法打开 YouTube 登录页面，请导入浏览器登录文件。", error); }
        });
    }
    @ActivityCallback private void youtubeLoginFinished(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() == NativeYoutubeLoginActivity.RESULT_IMPORT_COOKIES) { youtubeImportCookies(call); return; }
        if (result.getResultCode() != Activity.RESULT_OK) { execute(call, () -> manager.youtubeStatus().put("canceled", true)); return; }
        connectYoutubeCookies(call, "webview");
    }
    @PluginMethod public void youtubeOpen(PluginCall call) {
        try { getActivity().startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse("https://www.youtube.com/"))); call.resolve(); }
        catch (Exception error) { call.reject("无法打开 YouTube，请使用浏览器登录后导入登录文件。", error); }
    }
    @PluginMethod public void youtubeImportCookies(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
        getActivity().runOnUiThread(() -> {
            try { startActivityForResult(call, intent, "youtubeCookiesSelected"); }
            catch (Exception error) { call.reject("无法选择登录文件，请检查手机的文件选择器后重试。", error); }
        });
    }
    @ActivityCallback private void youtubeCookiesSelected(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            execute(call, () -> manager.youtubeStatus().put("canceled", true)); return;
        }
        Uri uri = result.getData().getData();
        execute(call, () -> {
            try (InputStream input = getContext().getContentResolver().openInputStream(uri); ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
                if (input == null) throw new IOException("无法读取 YouTube 登录文件。");
                byte[] buffer = new byte[4096]; int count;
                while ((count = input.read(buffer)) != -1) {
                    if (bytes.size() + count > NativeYoutubeCookies.MAX_BYTES) throw new IOException("YouTube 登录文件不能超过 128 KB。");
                    bytes.write(buffer, 0, count);
                }
                return manager.youtubeConfigure(new String(bytes.toByteArray(), StandardCharsets.UTF_8), "import");
            }
        });
    }
    @Override public void job(JSONObject job) {
        try { notifyListeners("jobChanged", new JSObject().put("job", new JSObject(job.toString()))); } catch (Exception ignored) {}
    }
    @Override public void library(JSONArray songs) {
        try { notifyListeners("libraryChanged", new JSObject().put("songs", new JSArray(songs.toString()))); } catch (Exception ignored) {}
    }
}
