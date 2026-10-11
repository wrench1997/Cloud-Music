package com.music.player;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import java.util.TreeMap;

/** Accept only YouTube cookies; never pass another site's browser session to the extractor. */
final class NativeYoutubeCookies {
    static final int MAX_BYTES = 128 * 1024;
    private static final Set<String> AUTH = new HashSet<>(Arrays.asList("SID", "SAPISID", "__Secure-1PSID", "__Secure-3PSID", "__Secure-1PAPISID", "__Secure-3PAPISID"));
    static String normalize(String text, long now) throws IOException {
        if (text == null || text.getBytes(StandardCharsets.UTF_8).length > MAX_BYTES) throw new IOException("YouTube 登录文件不能超过 128 KB。");
        String[] lines = text.replaceFirst("^\\uFEFF", "").split("\\r?\\n");
        if (lines.length == 0 || !lines[0].matches("# (Netscape HTTP Cookie File|HTTP Cookie File)\\s*")) throw new IOException("请选择浏览器导出的 Netscape cookies.txt 登录文件。");
        TreeMap<String, String> rows = new TreeMap<>(); Set<String> names = new HashSet<>();
        for (int i = 1; i < lines.length; i++) {
            String line = lines[i]; boolean httpOnly = line.startsWith("#HttpOnly_");
            if (line.isEmpty() || (line.startsWith("#") && !httpOnly)) continue;
            if (httpOnly) line = line.substring(10);
            String[] row = line.split("\\t", -1);
            if (row.length != 7) throw new IOException("登录文件格式不正确，请重新导出 cookies.txt。");
            if (!row[0].matches("(?i)\\.?([a-z0-9-]+\\.)*youtube\\.com")) continue;
            row[0] = row[0].toLowerCase(java.util.Locale.ROOT);
            if (!("TRUE".equals(row[1]) || "FALSE".equals(row[1])) || !("TRUE".equals(row[3]) || "FALSE".equals(row[3]))
                || !row[4].matches("[0-9]{1,12}") || !row[2].startsWith("/") || row[2].length() > 1024
                || !row[5].matches("[!#$%&'*+.^_`|~A-Za-z0-9-]{1,128}") || row[6].isEmpty() || row[6].length() > 4096
                || (row[2] + row[6]).matches("(?s).*[\\x00-\\x20\\x7f].*")) throw new IOException("YouTube 登录文件包含无效 Cookie，请重新导出。");
            long expiry = Long.parseLong(row[4]);
            if (expiry != 0 && expiry <= now / 1000) continue;
            rows.put(row[0] + "\t" + row[2] + "\t" + row[5], (httpOnly ? "#HttpOnly_" : "") + String.join("\t", row));
            names.add(row[5]);
            if (rows.size() > 300) throw new IOException("YouTube 登录文件包含过多 Cookie。");
        }
        names.retainAll(AUTH);
        if (names.isEmpty()) throw new IOException("文件中没有有效的 YouTube 登录，请在 YouTube 登录后重新导出。");
        return "# Netscape HTTP Cookie File\n" + String.join("\n", rows.values()) + "\n";
    }
    static String fromHeader(String header) throws IOException {
        StringBuilder text = new StringBuilder("# Netscape HTTP Cookie File\n");
        if (header != null) for (String part : header.split(";")) {
            int equal = part.indexOf('=');
            if (equal > 0) text.append("www.youtube.com\tFALSE\t/\tTRUE\t0\t").append(part.substring(0, equal).trim()).append('\t').append(part.substring(equal + 1).trim()).append('\n');
        }
        return normalize(text.toString(), System.currentTimeMillis());
    }
}
