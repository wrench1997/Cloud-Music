package com.music.player;

import org.json.JSONObject;
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
        assertEquals("https://www.youtube.com/results?search_query=%E5%91%A8%E6%9D%B0%E4%BC%A6%20%26%20friends&sp=EgIQAg%3D%3D", search.getString("requestUrl"));
        assertEquals(2, search.getInt("page"));
        assertEquals("https://www.youtube.com/channel/UCsXVk37bltHxD1rDPwtNM8Q/videos", NativeMusicCatalog.options(new JSONObject().put("provider", "youtube").put("kind", "artist").put("url", "https://music.youtube.com/browse/UCsXVk37bltHxD1rDPwtNM8Q")).getString("requestUrl"));
        assertEquals("https://music.youtube.com/playlist?list=OLAK5uy_album123", NativeMusicCatalog.options(new JSONObject().put("provider", "youtube").put("kind", "album").put("url", "https://music.youtube.com/watch?v=abcdefghijk&list=OLAK5uy_album123")).getString("requestUrl"));
        assertTrue(NativeMusicCatalog.options(new JSONObject().put("provider", "youtube").put("kind", "new")).getString("requestUrl").contains("sp=CAISBAgDEAE%3D"));
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
