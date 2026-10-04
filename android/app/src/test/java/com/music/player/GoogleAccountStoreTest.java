package com.music.player;

import static org.junit.Assert.*;
import java.io.File;
import java.io.FileOutputStream;
import java.nio.charset.StandardCharsets;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class GoogleAccountStoreTest {
    @Rule public TemporaryFolder temporary = new TemporaryFolder();

    @Test public void selectedAccountSurvivesRestartAndExplicitLogoutClearsIt() throws Exception {
        File directory = temporary.newFolder();
        GoogleAccountStore first = new GoogleAccountStore(directory);
        assertNull(first.read());
        first.write("verified@example.com");
        GoogleAccountStore restored = new GoogleAccountStore(directory);
        assertEquals("verified@example.com", restored.read());
        restored.write("another@example.com");
        assertEquals("another@example.com", first.read());
        restored.clear();
        assertNull(new GoogleAccountStore(directory).read());
        assertEquals(0, directory.list().length);
    }

    @Test public void corruptAndOversizedAccountFilesCannotRestoreASession() throws Exception {
        File directory = temporary.newFolder();
        File saved = new File(directory, "google-account-email");
        GoogleAccountStore store = new GoogleAccountStore(directory);
        for (String value : new String[] { "", "not-an-account", "account@example.com\n", "a".repeat(1281) }) {
            try (FileOutputStream output = new FileOutputStream(saved)) { output.write(value.getBytes(StandardCharsets.UTF_8)); }
            assertNull(store.read());
        }
        try { store.write("invalid"); fail("Invalid accounts must be rejected"); }
        catch (java.io.IOException expected) { assertTrue(expected.getMessage().contains("无效")); }
    }
}
