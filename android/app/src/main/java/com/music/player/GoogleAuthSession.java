package com.music.player;

import java.io.IOException;

/** Separates a verified, remembered account from an account currently being authorized. */
final class GoogleAuthSession {
    static final class Snapshot {
        final int generation;
        final String account;
        final String token;
        final long expiresAt;
        final int tokenRevision;
        final boolean refreshPending;
        final String tokenToClear;

        Snapshot(int generation, String account, String token, long expiresAt, int tokenRevision, boolean refreshPending, String rejectedToken) {
            this.generation = generation;
            this.account = account;
            this.token = token;
            this.expiresAt = expiresAt;
            this.tokenRevision = tokenRevision;
            this.refreshPending = refreshPending;
            this.tokenToClear = token != null ? token : rejectedToken;
        }

        String validToken(long now) { return !refreshPending && token != null && expiresAt > now ? token : null; }
    }

    private boolean initialized;
    private int generation;
    private String rememberedAccount;
    private String account;
    private String token;
    private long expiresAt;
    private int tokenRevision;
    private boolean refreshPending;
    private String rejectedToken;

    synchronized void initialize(String savedAccount) {
        if (initialized) return;
        initialized = true;
        rememberedAccount = savedAccount;
        account = savedAccount;
    }

    synchronized Snapshot snapshot() { return new Snapshot(generation, account, token, expiresAt, tokenRevision, refreshPending, rejectedToken); }

    synchronized boolean isCurrent(int value) { return generation == value; }

    synchronized int beginInteractive() {
        generation++;
        account = null;
        token = null;
        expiresAt = 0;
        tokenRevision++;
        refreshPending = false;
        rejectedToken = null;
        return generation;
    }

    synchronized void cancelInteractive(int attemptedGeneration) {
        if (generation != attemptedGeneration) return;
        generation++;
        account = rememberedAccount;
        token = null;
        expiresAt = 0;
        tokenRevision++;
        refreshPending = false;
        rejectedToken = null;
    }

    synchronized String cache(String nextAccount, String nextToken, long nextExpiry, int value, int revision, boolean refreshOwner) throws IOException {
        if (generation != value) throw GoogleAuthFailure.cancelled();
        if (tokenRevision != revision || (refreshPending && !refreshOwner)) throw GoogleAuthFailure.temporary();
        if (nextAccount == null || nextToken == null) throw GoogleAuthFailure.required();
        if (account != null && !account.equalsIgnoreCase(nextAccount)) throw GoogleAuthFailure.cancelled();
        account = nextAccount;
        token = nextToken;
        rejectedToken = null;
        expiresAt = nextExpiry;
        return token;
    }

    synchronized void invalidateToken(String rejectedToken, int value) {
        if (generation != value || rejectedToken == null || !rejectedToken.equals(token)) return;
        this.rejectedToken = token;
        token = null;
        expiresAt = 0;
    }

    synchronized Snapshot beginTokenRefresh(String rejectedToken, int value) throws IOException {
        if (generation != value) throw GoogleAuthFailure.cancelled();
        if (refreshPending) throw GoogleAuthFailure.temporary();
        String currentToken = token != null ? token : this.rejectedToken;
        if (rejectedToken == null || !rejectedToken.equals(currentToken)) throw GoogleAuthFailure.temporary();
        invalidateToken(rejectedToken, value);
        tokenRevision++;
        refreshPending = true;
        return snapshot();
    }

    synchronized void endTokenRefresh(int value, int revision) {
        if (generation == value && tokenRevision == revision) refreshPending = false;
    }

    synchronized void requireVerifiedAccount(String email) throws IOException {
        if (account == null || email == null || !account.equalsIgnoreCase(email) || token == null) {
            throw GoogleAuthFailure.cancelled();
        }
    }

    synchronized void rememberVerifiedAccount(String email) throws IOException {
        requireVerifiedAccount(email);
        rememberedAccount = email;
        account = email;
    }

    synchronized void clear() {
        initialized = true;
        generation++;
        rememberedAccount = null;
        account = null;
        token = null;
        expiresAt = 0;
        tokenRevision++;
        refreshPending = false;
        rejectedToken = null;
    }
}
