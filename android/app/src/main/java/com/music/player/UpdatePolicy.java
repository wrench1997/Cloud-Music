package com.music.player;

import java.net.URL;

final class UpdatePolicy {
    static final String REPOSITORY = "wrench1997/Cloud-Music";

    static int compareVersions(String first, String second) {
        if (!first.matches("[0-9]+\\.[0-9]+\\.[0-9]+") || !second.matches("[0-9]+\\.[0-9]+\\.[0-9]+")) throw new IllegalArgumentException("更新版本号无效。");
        String[] left = first.split("\\."); String[] right = second.split("\\.");
        for (int i = 0; i < 3; i++) { int compare = Integer.compare(Integer.parseInt(left[i]), Integer.parseInt(right[i])); if (compare != 0) return compare; }
        return 0;
    }

    static String validateAssetUrl(String address, String tag, String fileName) throws Exception {
        if (!tag.matches("v?[0-9]+\\.[0-9]+\\.[0-9]+") || !fileName.matches("android-update\\.json|Yungan-Music-Android-[0-9]+\\.[0-9]+\\.[0-9]+\\.apk")) throw new IllegalStateException("更新下载地址无效。");
        URL url = new URL(address);
        String expected = "/" + REPOSITORY + "/releases/download/" + tag + "/" + fileName;
        if (!url.getProtocol().equals("https") || !url.getHost().equals("github.com") || url.getPort() != -1
                || url.getUserInfo() != null || url.getQuery() != null || url.getRef() != null || !url.getPath().equals(expected)) throw new IllegalStateException("更新下载地址无效。");
        return address;
    }

    static boolean isTrustedDownloadHost(URL url) {
        String host = url.getHost();
        return url.getProtocol().equals("https") && url.getUserInfo() == null && (url.getPort() == -1 || url.getPort() == 443)
                && (host.equals("api.github.com") || host.equals("github.com") || host.equals("release-assets.githubusercontent.com") || host.equals("objects.githubusercontent.com"));
    }
}
