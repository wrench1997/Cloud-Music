package com.music.player;

import java.net.URI;
import java.util.Locale;

/** The account page has no application bridge and may navigate only to official HTTPS account pages. */
final class NativeYoutubeLoginPolicy {
    static final String START_URL = "https://www.youtube.com/";
    private NativeYoutubeLoginPolicy() {}

    static boolean canLoad(String address) {
        try {
            URI uri = new URI(address);
            if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getUserInfo() != null
                    || (uri.getPort() != -1 && uri.getPort() != 443) || uri.getHost() == null) return false;
            String host = uri.getHost().toLowerCase(Locale.ROOT);
            return host.equals("youtube.com") || host.endsWith(".youtube.com")
                || host.equals("accounts.google.com") || host.equals("myaccount.google.com") || host.equals("www.google.com");
        } catch (Exception ignored) { return false; }
    }

    static String host(String address) {
        if (!canLoad(address)) return "";
        try { return new URI(address).getHost().toLowerCase(Locale.ROOT); }
        catch (Exception ignored) { return ""; }
    }
}
