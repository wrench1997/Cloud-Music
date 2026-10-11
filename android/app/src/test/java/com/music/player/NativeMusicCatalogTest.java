package com.music.player;

import org.json.JSONObject;
import org.json.JSONArray;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import org.junit.Test;
import static org.junit.Assert.*;

public class NativeMusicCatalogTest {
    @Test public void spotifyReadsPublicNewMusicAndCanonicalArtistAlbumPages() throws Exception {
        assertEquals("https://open.spotify.com/embed/playlist/37i9dQZF1DX4JAvHpjipBk", NativeMusicCatalog.options(new JSONObject().put("provider", "spotify").put("kind", "new")).getString("requestUrl"));
        JSONObject artist = NativeMusicCatalog.options(new JSONObject().put("provider", "spotify").put("kind", "artist").put("url", "https://open.spotify.com/intl-zh/embed/artist/6LqNN22kT3074XbTVUrhzX?si=tracking"));
        assertEquals("https://open.spotify.com/artist/6LqNN22kT3074XbTVUrhzX", artist.getString("requestUrl"));
        assertEquals(12, artist.getInt("limit"));
        JSONObject album = NativeMusicCatalog.options(new JSONObject().put("provider", "spotify").put("kind", "album").put("url", "https://open.spotify.com/album/6QcXrZaGM8gIrvSCNrVlUj"));
        assertEquals(100, album.getInt("limit"));
    }
    @Test public void youtubeSearchIncludesMusicEntityTypeAndBoundedPage() throws Exception {
        JSONObject search = NativeMusicCatalog.options(new JSONObject().put("provider", "youtube").put("kind", "artists").put("query", "周杰伦 & friends").put("page", 2));
        assertEquals("https://music.youtube.com/search?q=%E5%91%A8%E6%9D%B0%E4%BC%A6%20%26%20friends#artists", search.getString("requestUrl"));
        assertEquals(2, search.getInt("page"));
        assertEquals("https://www.youtube.com/channel/UCsXVk37bltHxD1rDPwtNM8Q/releases", NativeMusicCatalog.options(new JSONObject().put("provider", "youtube").put("kind", "artist").put("url", "https://music.youtube.com/browse/UCsXVk37bltHxD1rDPwtNM8Q")).getString("requestUrl"));
        assertEquals("https://music.youtube.com/playlist?list=OLAK5uy_album123", NativeMusicCatalog.options(new JSONObject().put("provider", "youtube").put("kind", "album").put("url", "https://music.youtube.com/watch?v=abcdefghijk&list=OLAK5uy_album123")).getString("requestUrl"));
        assertTrue(NativeMusicCatalog.options(new JSONObject().put("provider", "youtube").put("kind", "new")).getString("requestUrl").contains("sp=CAISBAgDEAE%3D"));
    }
    @Test public void releaseOnlyArtistsAndTopicFallbackKeepTheRequestedIdentity() throws Exception {
        JSONObject options = NativeMusicCatalog.options(new JSONObject().put("provider", "youtube").put("kind", "artist").put("url", "https://www.youtube.com/channel/UCuY7e4kMpba1PRN8QAeTBRg"));
        List<String> calls = new ArrayList<>();
        JSONObject release = NativeMusicCatalog.readArtistCatalog(options, url -> {
            calls.add(url);
            return new JSONObject().put("entries", new JSONArray().put(new JSONObject().put("url", "https://www.youtube.com/playlist?list=OLAK5uy_release1")));
        });
        assertEquals(1, calls.size());
        assertTrue(calls.get(0).endsWith("/releases"));
        assertEquals("releases", release.getString("catalogSource"));
        calls.clear();
        JSONObject topic = NativeMusicCatalog.readArtistCatalog(options, url -> {
            calls.add(url);
            if (url.endsWith("/releases")) throw new IOException("This channel does not have a releases tab");
            if (url.endsWith("/videos")) throw new IOException("This channel does not have a videos tab");
            return new JSONObject().put("entries", new JSONArray().put(new JSONObject().put("id", "Vz3-xvAQ2wg")));
        });
        assertEquals(3, calls.size());
        assertEquals("channel", topic.getString("catalogSource"));
        assertEquals("https://www.youtube.com/channel/UCuY7e4kMpba1PRN8QAeTBRg", calls.get(2));
        assertEquals("https://www.youtube.com/@%E5%91%A8%E6%9D%B0%E4%BC%A6/releases", NativeMusicCatalog.options(new JSONObject().put("provider", "youtube").put("kind", "artist").put("url", "https://www.youtube.com/@周杰伦/videos")).getString("requestUrl"));
    }
    @Test public void authenticationErrorsAndExhaustedPagesDoNotSwitchDirectories() throws Exception {
        JSONObject options = NativeMusicCatalog.options(new JSONObject().put("provider", "youtube").put("kind", "artist").put("url", "https://www.youtube.com/channel/UCuY7e4kMpba1PRN8QAeTBRg"));
        List<String> calls = new ArrayList<>();
        try {
            NativeMusicCatalog.readArtistCatalog(options, url -> { calls.add(url); throw new IOException("Sign in to confirm you are not a bot"); });
            fail();
        } catch (IOException expected) { assertTrue(expected.getMessage().contains("Sign in")); }
        assertEquals(1, calls.size());
        calls.clear();
        JSONObject page = NativeMusicCatalog.readArtistCatalog(options.put("page", 2), url -> { calls.add(url); return new JSONObject().put("entries", new JSONArray()); });
        assertEquals(1, calls.size());
        assertEquals("releases", page.getString("catalogSource"));
    }
    @Test public void otherHostsCredentialsAndMismatchedKindsNeverReachTheFetcher() throws Exception {
        for (String url : new String[]{"http://open.spotify.com/artist/6LqNN22kT3074XbTVUrhzX", "https://user@open.spotify.com/artist/6LqNN22kT3074XbTVUrhzX", "https://open.spotify.com:443/artist/6LqNN22kT3074XbTVUrhzX", "https://open.spotify.com.evil.test/artist/6LqNN22kT3074XbTVUrhzX", "https://evil.test/artist/6LqNN22kT3074XbTVUrhzX", "file:///private"}) {
            try { NativeMusicCatalog.options(new JSONObject().put("provider", "spotify").put("kind", "artist").put("url", url)); fail(url); } catch (Exception expected) {}
        }
        try { NativeMusicCatalog.options(new JSONObject().put("provider", "youtube").put("kind", "album").put("url", "https://www.youtube.com/@artist")); fail(); } catch (Exception expected) {}
        for (Object page : new Object[]{0, 6, "2", 1.5}) {
            try { NativeMusicCatalog.options(new JSONObject().put("provider", "youtube").put("kind", "new").put("page", page)); fail(); } catch (Exception expected) {}
        }
    }
}
