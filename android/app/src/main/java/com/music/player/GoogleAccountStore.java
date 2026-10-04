package com.music.player;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;

/** Remembers the selected account only. Google Play services owns the OAuth credentials. */
final class GoogleAccountStore {
    private final File file;

    GoogleAccountStore(File directory) {
        file = new File(directory, "google-account-email");
    }

    private static boolean valid(String email) {
        return email != null && email.length() <= 320 && email.matches("[^\\s@\\p{Cntrl}]+@[^\\s@\\p{Cntrl}]+");
    }

    synchronized String read() {
        if (!file.isFile() || file.length() > 1280) return null;
        try (FileInputStream input = new FileInputStream(file)) {
            byte[] bytes = new byte[1281];
            int length = 0;
            int count;
            while (length < bytes.length && (count = input.read(bytes, length, bytes.length - length)) != -1) length += count;
            if (length > 1280) return null;
            String email = new String(bytes, 0, length, StandardCharsets.UTF_8);
            return valid(email) ? email : null;
        } catch (IOException error) { return null; }
    }

    synchronized void write(String email) throws IOException {
        if (!valid(email)) throw new IOException("无效的 Google 账号。");
        File directory = file.getParentFile();
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("无法记住 Google 账号，请检查存储空间。");
        try (FileOutputStream output = new FileOutputStream(file)) {
            output.write(email.getBytes(StandardCharsets.UTF_8));
            output.getFD().sync();
        }
    }

    synchronized void clear() throws IOException {
        if (file.exists() && !file.delete()) {
            // Truncation prevents a failed unlink from restoring a logged-out account on the next launch.
            try (FileOutputStream output = new FileOutputStream(file)) { output.getFD().sync(); }
        }
    }
}
