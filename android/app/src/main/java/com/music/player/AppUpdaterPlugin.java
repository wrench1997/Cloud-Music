package com.music.player;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.content.pm.Signature;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.HashSet;
import java.util.Set;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicBoolean;
import org.json.JSONArray;
import org.json.JSONObject;

@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {
    private static final String REPOSITORY = "wrench1997/Cloud-Music";
    private static final String API = "https://api.github.com/repos/" + REPOSITORY + "/releases/latest";
    private static final String RELEASES = "https://github.com/" + REPOSITORY + "/releases";
    private static final long MAX_APK_BYTES = 600L * 1024 * 1024;
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final AtomicBoolean busy = new AtomicBoolean(false);
    private volatile JSObject state;
    private JSONObject candidate;
    private File downloaded;

    @Override
    public void load() {
        state = new JSObject();
        state.put("state", "idle");
        state.put("currentVersion", BuildConfig.VERSION_NAME);
        state.put("releasesUrl", RELEASES);
    }

    private synchronized JSObject snapshot() {
        try { return new JSObject(state.toString()); }
        catch (Exception error) { return state; }
    }

    private synchronized void publish(String name, String error, int progress) {
        state.put("state", name);
        state.put("error", error == null ? JSONObject.NULL : error);
        if (progress >= 0) state.put("progress", progress);
        notifyListeners("state", snapshot());
    }

    @PluginMethod
    public void status(PluginCall call) { call.resolve(snapshot()); }

    @PluginMethod
    public void check(PluginCall call) {
        if (!busy.compareAndSet(false, true)) { call.resolve(snapshot()); return; }
        executor.execute(() -> {
            try {
                // Keep a verified download available until the user installs it.
                if (downloaded != null && downloaded.isFile()) { call.resolve(snapshot()); return; }
                publish("checking", null, -1);
                HttpURLConnection response = openTrusted(API);
                int status = response.getResponseCode();
                if (status == 404) { response.disconnect(); publish("unpublished", null, -1); call.resolve(snapshot()); return; }
                if (status != 200) { response.disconnect(); throw new IllegalStateException("GitHub 暂时无法访问，请稍后重试。"); }
                JSONObject release;
                try (InputStream input = response.getInputStream()) { release = new JSONObject(readText(input, 2 * 1024 * 1024)); }
                finally { response.disconnect(); }
                if (release.optBoolean("draft") || release.optBoolean("prerelease")) throw new IllegalStateException("更新版本尚未正式发布。");
                String tag = release.getString("tag_name");
                if (!tag.matches("v?[0-9]+\\.[0-9]+\\.[0-9]+")) throw new IllegalStateException("更新版本号无效。");
                JSONArray assets = release.getJSONArray("assets");
                JSONObject manifestAsset = null;
                for (int i = 0; i < assets.length(); i++) if (assets.getJSONObject(i).optString("name").equals("android-update.json")) manifestAsset = assets.getJSONObject(i);
                if (manifestAsset == null) { publish("unpublished", null, -1); call.resolve(snapshot()); return; }
                String manifestUrl = UpdatePolicy.validateAssetUrl(manifestAsset.getString("browser_download_url"), tag, "android-update.json");
                JSONObject manifest;
                HttpURLConnection manifestResponse = openTrusted(manifestUrl);
                try (InputStream input = manifestResponse.getInputStream()) { manifest = new JSONObject(readText(input, 65536)); }
                finally { manifestResponse.disconnect(); }
                String version = manifest.getString("version");
                int code = manifest.getInt("versionCode");
                String name = manifest.getString("fileName");
                String sha = manifest.getString("sha256");
                long size = manifest.getLong("size");
                if (manifest.getInt("schemaVersion") != 1 || !version.matches("[0-9]+\\.[0-9]+\\.[0-9]+") || !name.equals("Yungan-Music-Android-" + version + ".apk")
                        || !sha.matches("[a-fA-F0-9]{64}") || size <= 0 || size > MAX_APK_BYTES
                        || !manifest.getString("packageId").equals(getContext().getPackageName())) throw new IllegalStateException("更新信息无效。");
                if (code <= BuildConfig.VERSION_CODE) { candidate = null; publish("current", null, -1); call.resolve(snapshot()); return; }
                if (UpdatePolicy.compareVersions(version, BuildConfig.VERSION_NAME) <= 0) throw new IllegalStateException("更新版本号与安装版本不匹配。");
                JSONObject apk = null;
                for (int i = 0; i < assets.length(); i++) if (assets.getJSONObject(i).optString("name").equals(name)) apk = assets.getJSONObject(i);
                if (apk == null || apk.getLong("size") != size) throw new IllegalStateException("更新安装包尚未发布完整。");
                String digest = apk.optString("digest");
                if (!digest.isEmpty() && !digest.equalsIgnoreCase("sha256:" + sha)) throw new IllegalStateException("安装包校验信息不匹配。");
                String url = UpdatePolicy.validateAssetUrl(apk.getString("browser_download_url"), tag, name);
                candidate = manifest.put("url", url);
                state.put("version", version);
                state.put("permissionRequired", false);
                publish("available", null, 0);
                call.resolve(snapshot());
            } catch (Exception error) { publish("error", "暂时无法检查更新，请检查网络后重试。", -1); call.resolve(snapshot()); }
            finally { busy.set(false); }
        });
    }

    @PluginMethod
    public void download(PluginCall call) {
        if (candidate == null) { call.reject("请先检查更新。"); return; }
        if (!busy.compareAndSet(false, true)) { call.resolve(snapshot()); return; }
        executor.execute(() -> {
            File target = new File(getContext().getCacheDir(), "updates/update.apk");
            HttpURLConnection response = null;
            try {
                if (!target.getParentFile().isDirectory() && !target.getParentFile().mkdirs()) throw new IllegalStateException("无法创建更新目录。");
                publish("downloading", null, 0);
                response = openTrusted(candidate.getString("url"));
                if (response.getResponseCode() != 200) throw new IllegalStateException("下载更新失败，请稍后重试。");
                long expectedSize = candidate.getLong("size");
                long declaredSize = response.getContentLengthLong();
                if (declaredSize > 0 && declaredSize != expectedSize) throw new IllegalStateException("安装包大小不匹配。");
                MessageDigest digest = MessageDigest.getInstance("SHA-256");
                long received = 0;
                int lastPercent = -1;
                try (InputStream input = response.getInputStream(); FileOutputStream output = new FileOutputStream(target)) {
                    byte[] buffer = new byte[65536];
                    int count;
                    while ((count = input.read(buffer)) != -1) {
                        received += count;
                        if (received > expectedSize || received > MAX_APK_BYTES) throw new IllegalStateException("安装包大小超出预期。");
                        output.write(buffer, 0, count);
                        digest.update(buffer, 0, count);
                        int percent = (int) (received * 100 / expectedSize);
                        if (percent != lastPercent) { publish("downloading", null, percent); lastPercent = percent; }
                    }
                }
                if (received != expectedSize || !hex(digest.digest()).equalsIgnoreCase(candidate.getString("sha256"))) throw new IllegalStateException("安装包校验失败，请重新下载。");
                verifyApk(target);
                downloaded = target;
                publish("downloaded", null, 100);
                call.resolve(snapshot());
            } catch (Exception error) {
                target.delete();
                downloaded = null;
                publish("available", "安装包下载或验证失败，请重试。", 0);
                call.reject(error.getMessage() == null ? "下载更新失败。" : error.getMessage());
            } finally { if (response != null) response.disconnect(); busy.set(false); }
        });
    }

    @PluginMethod
    public void install(PluginCall call) {
        if (downloaded == null || !downloaded.isFile()) { call.reject("请先下载更新。"); return; }
        try {
            verifyApk(downloaded);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && !getContext().getPackageManager().canRequestPackageInstalls()) {
                state.put("permissionRequired", true);
                Intent permission = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
                permission.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(permission);
                call.resolve(snapshot());
                return;
            }
            state.put("permissionRequired", false);
            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", downloaded);
            Intent installer = new Intent(Intent.ACTION_VIEW);
            installer.setDataAndType(uri, "application/vnd.android.package-archive");
            installer.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(installer);
            // The system installer asks the user before replacing this app.
            call.resolve(snapshot());
        } catch (Exception error) { call.reject(error.getMessage() == null ? "无法打开更新安装程序。" : error.getMessage()); }
    }

    @SuppressWarnings("deprecation")
    private void verifyApk(File apk) throws Exception {
        PackageManager manager = getContext().getPackageManager();
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? PackageManager.GET_SIGNING_CERTIFICATES : PackageManager.GET_SIGNATURES;
        PackageInfo archive = manager.getPackageArchiveInfo(apk.getAbsolutePath(), flags);
        PackageInfo current = manager.getPackageInfo(getContext().getPackageName(), flags);
        if (archive == null || !getContext().getPackageName().equals(archive.packageName)
                || versionCode(archive) != candidate.getInt("versionCode") || !candidate.getString("version").equals(archive.versionName)
                || versionCode(archive) <= versionCode(current)) throw new IllegalStateException("更新安装包的应用或版本不匹配。");
        Signature[] existing = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? current.signingInfo.getApkContentsSigners() : current.signatures;
        Signature[] replacement = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? archive.signingInfo.getApkContentsSigners() : archive.signatures;
        Set<String> installed = hashes(existing);
        if (installed.isEmpty() || !installed.equals(hashes(replacement))) throw new IllegalStateException("更新签名与已安装应用不同，无法安全更新。");
    }

    private static Set<String> hashes(Signature[] signatures) throws Exception {
        Set<String> result = new HashSet<>();
        if (signatures != null) for (Signature signature : signatures) result.add(hex(MessageDigest.getInstance("SHA-256").digest(signature.toByteArray())));
        return result;
    }

    @SuppressWarnings("deprecation")
    private static long versionCode(PackageInfo info) { return Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? info.getLongVersionCode() : info.versionCode; }

    private static HttpURLConnection openTrusted(String address) throws Exception {
        URL url = new URL(address);
        for (int redirects = 0; redirects <= 5; redirects++) {
            if (!UpdatePolicy.isTrustedDownloadHost(url)) throw new IllegalStateException("更新服务器地址无效。");
            HttpURLConnection connection = (HttpURLConnection) url.openConnection();
            connection.setConnectTimeout(20000); connection.setReadTimeout(60000); connection.setInstanceFollowRedirects(false);
            connection.setRequestProperty("User-Agent", "Yungan-Music-Updater/" + BuildConfig.VERSION_NAME);
            connection.setRequestProperty("Accept", "application/vnd.github+json");
            int status = connection.getResponseCode();
            if (status == 301 || status == 302 || status == 303 || status == 307 || status == 308) {
                String location = connection.getHeaderField("Location"); connection.disconnect();
                if (location == null) throw new IllegalStateException("更新服务器没有返回下载地址。");
                url = new URL(url, location); continue;
            }
            return connection;
        }
        throw new IllegalStateException("更新服务器重定向过多。");
    }

    private static String readText(InputStream input, int maximum) throws Exception {
        ByteArrayOutputStream bytes = new ByteArrayOutputStream();
        byte[] buffer = new byte[8192]; int count;
        while ((count = input.read(buffer)) != -1) { if (bytes.size() + count > maximum) throw new IllegalStateException("更新信息过大。"); bytes.write(buffer, 0, count); }
        return bytes.toString(StandardCharsets.UTF_8.name());
    }

    private static String hex(byte[] bytes) {
        StringBuilder text = new StringBuilder(); for (byte value : bytes) text.append(String.format("%02x", value & 255)); return text.toString();
    }
}
