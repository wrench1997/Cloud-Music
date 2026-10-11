package com.music.player;

import android.content.Context;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;
import org.json.JSONObject;
import java.io.File;
import java.io.FileInputStream;
import java.io.ByteArrayOutputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.util.UUID;
import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

/** Account cookies are encrypted with this installation's Android Keystore key and excluded from backup. */
final class NativeYoutubeDownloadSession {
    private static final String KEY = "yungan-youtube-download";
    private final File credentials, temporaryDirectory;
    private JSONObject saved;
    private boolean initialized;
    NativeYoutubeDownloadSession(Context context) {
        credentials = new File(context.getNoBackupFilesDir(), "youtube-download-account.bin");
        temporaryDirectory = new File(context.getCacheDir(), "youtube-download-sessions");
    }
    private SecretKey key() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (store.containsAlias(KEY)) return (SecretKey) store.getKey(KEY, null);
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(KEY, KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT)
            .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build());
        return generator.generateKey();
    }
    private void initialize() {
        if (initialized) return; initialized = true;
        File[] stale = temporaryDirectory.listFiles();
        if (stale != null) for (File file : stale) if (file.getName().matches("session-[A-Za-z0-9-]+\\.txt")) file.delete();
        try {
            if (!credentials.isFile() || credentials.length() > NativeYoutubeCookies.MAX_BYTES * 2) return;
            byte[] data;
            try (FileInputStream input = new FileInputStream(credentials); ByteArrayOutputStream bytes = new ByteArrayOutputStream()) {
                byte[] buffer = new byte[4096]; int count;
                while ((count = input.read(buffer)) != -1) {
                    if (bytes.size() + count > NativeYoutubeCookies.MAX_BYTES * 2) return;
                    bytes.write(buffer, 0, count);
                }
                data = bytes.toByteArray();
            }
            if (data.length < 29 || data[0] != 1) return;
            Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
            cipher.init(Cipher.DECRYPT_MODE, key(), new GCMParameterSpec(128, java.util.Arrays.copyOfRange(data, 1, 13)));
            saved = new JSONObject(new String(cipher.doFinal(data, 13, data.length - 13), StandardCharsets.UTF_8));
        } catch (Exception ignored) { saved = null; }
    }
    synchronized JSONObject status() throws Exception {
        initialize();
        JSONObject result = new JSONObject().put("supported", true).put("configured", false).put("revision", "");
        if (saved != null) {
            try {
                NativeYoutubeCookies.normalize(saved.getString("text"), System.currentTimeMillis());
                return result.put("configured", true).put("revision", saved.getString("revision")).put("source", saved.optString("source"));
            } catch (Exception ignored) { result.put("message", "YouTube 下载登录已过期，请重新接入登录。"); }
        }
        return result;
    }
    synchronized JSONObject configure(String text, String source) throws Exception {
        String normalized = NativeYoutubeCookies.normalize(text, System.currentTimeMillis()); initialize();
        JSONObject next = new JSONObject().put("text", normalized).put("source", source)
            .put("revision", saved != null && normalized.equals(saved.optString("text")) ? saved.getString("revision") : UUID.randomUUID().toString());
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, key());
        byte[] encoded = cipher.doFinal(next.toString().getBytes(StandardCharsets.UTF_8));
        File temporary = new File(credentials.getParentFile(), "youtube-download-account.bin.tmp");
        try (FileOutputStream output = new FileOutputStream(temporary)) { output.write(1); output.write(cipher.getIV()); output.write(encoded); output.getFD().sync(); }
        if (!temporary.renameTo(credentials)) { temporary.delete(); throw new IOException("无法保存 YouTube 下载登录。"); }
        saved = next; return status();
    }
    synchronized File lease() throws Exception {
        if (!status().optBoolean("configured")) return null;
        if (!temporaryDirectory.isDirectory() && !temporaryDirectory.mkdirs()) throw new IOException("无法准备 YouTube 下载登录。");
        File file = File.createTempFile("session-", ".txt", temporaryDirectory);
        try (FileOutputStream output = new FileOutputStream(file)) {
            output.write(NativeYoutubeCookies.normalize(saved.getString("text"), System.currentTimeMillis()).getBytes(StandardCharsets.UTF_8));
        } catch (Exception error) { file.delete(); throw error; }
        return file;
    }
    synchronized JSONObject clear() throws Exception {
        initialize();
        if (credentials.exists() && !credentials.delete()) throw new IOException("无法移除 YouTube 下载登录。");
        saved = null; return status();
    }
}
