package com.music.player;

import static org.junit.Assert.*;
import java.net.URL;
import org.junit.Test;

public class UpdatePolicyTest {
    @Test public void comparesNumericVersionsAndRejectsMalformedVersions() {
        assertTrue(UpdatePolicy.compareVersions("3.10.0", "3.2.0") > 0);
        assertTrue(UpdatePolicy.compareVersions("2.99.99", "3.0.0") < 0);
        assertEquals(0, UpdatePolicy.compareVersions("3.2.0", "3.2.0"));
        assertThrows(IllegalArgumentException.class, () -> UpdatePolicy.compareVersions("3.2.0-beta", "3.2.0"));
    }

    @Test public void updateAssetsMustBelongToExactRepositoryAndRelease() throws Exception {
        String accepted = "https://github.com/wrench1997/Cloud-Music/releases/download/v1.2.0/Yungan-Music-Android-3.2.0.apk";
        assertEquals(accepted, UpdatePolicy.validateAssetUrl(accepted, "v1.2.0", "Yungan-Music-Android-3.2.0.apk"));
        for (String rejected : new String[] {
                accepted.replace("https:", "http:"), accepted.replace("github.com", "github.com.attacker.example"),
                accepted.replace("wrench1997", "someone"), accepted.replace("v1.2.0", "v1.1.0"),
                accepted + "?redirect=elsewhere", accepted.replace("github.com", "user@github.com"), accepted + "#fragment" }) {
            assertThrows(IllegalStateException.class, () -> UpdatePolicy.validateAssetUrl(rejected, "v1.2.0", "Yungan-Music-Android-3.2.0.apk"));
        }
        assertThrows(IllegalStateException.class, () -> UpdatePolicy.validateAssetUrl(accepted, "../v1.2.0", "Yungan-Music-Android-3.2.0.apk"));
    }

    @Test public void redirectsOnlyUseGithubHttpsAssetHosts() throws Exception {
        assertTrue(UpdatePolicy.isTrustedDownloadHost(new URL("https://release-assets.githubusercontent.com/github-production-release-asset/abc?signature=opaque")));
        assertFalse(UpdatePolicy.isTrustedDownloadHost(new URL("http://objects.githubusercontent.com/file")));
        assertFalse(UpdatePolicy.isTrustedDownloadHost(new URL("https://github.com:444/file")));
        assertFalse(UpdatePolicy.isTrustedDownloadHost(new URL("https://github.com.attacker.example/file")));
        assertFalse(UpdatePolicy.isTrustedDownloadHost(new URL("https://user@github.com/file")));
    }
}
