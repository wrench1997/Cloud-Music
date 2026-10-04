package com.music.player;

import android.accounts.Account;
import android.accounts.AccountManager;
import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationClient;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.ClearTokenRequest;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.AccountPicker;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.api.Scope;
import com.google.android.gms.tasks.Tasks;
import com.google.android.gms.tasks.Task;
import java.io.IOException;
import java.util.Collections;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.TimeUnit;

@CapacitorPlugin(name = "GoogleDriveAuth", requestCodes = { 9026, 9027 })
public class GoogleDriveAuthPlugin extends Plugin {
    private static final List<String> DRIVE_SCOPES = Arrays.asList(
        "https://www.googleapis.com/auth/drive.readonly", "https://www.googleapis.com/auth/drive.file");
    private static final GoogleAuthSession session = new GoogleAuthSession();
    private GoogleAccountStore accountStore;
    private PluginCall pendingCall;
    private int pendingGeneration;
    private int pendingTokenRevision;

    @Override
    public void load() {
        // The no-backup directory avoids carrying an account selection to another device via cloud backup.
        accountStore = new GoogleAccountStore(getContext().getNoBackupFilesDir());
        session.initialize(accountStore.read());
    }

    @PluginMethod
    public void status(PluginCall call) {
        String account = session.snapshot().account;
        call.resolve(new JSObject().put("configured", true).put("connected", account != null)
            .put("remembersLogin", true).put("account", account));
    }

    private static AuthorizationRequest request(String email) {
        AuthorizationRequest.Builder builder = AuthorizationRequest.builder()
            .setRequestedScopes(Arrays.asList(new Scope(DRIVE_SCOPES.get(0)), new Scope(DRIVE_SCOPES.get(1))));
        if (email != null && !email.isEmpty()) builder.setAccount(new Account(email, "com.google"));
        return builder.build();
    }

    private static String cache(AuthorizationResult result, String email, int generation, int revision, boolean refreshOwner) throws IOException {
        if (!session.isCurrent(generation)) throw GoogleAuthFailure.cancelled();
        String token = result.getAccessToken();
        if (token == null || !result.getGrantedScopes().containsAll(DRIVE_SCOPES)) {
            throw GoogleAuthFailure.required();
        }
        return session.cache(email, token, System.currentTimeMillis() + TimeUnit.MINUTES.toMillis(45), generation, revision, refreshOwner);
    }

    private static GoogleAuthFailure failure(Throwable error) {
        return GoogleAuthFailure.from(error, current -> current instanceof ApiException ? ((ApiException) current).getStatusCode() : null);
    }

    private void reject(PluginCall call, int generation, Throwable error) {
        GoogleAuthFailure reason = session.isCurrent(generation) ? failure(error) : GoogleAuthFailure.cancelled();
        if (pendingCall == call) pendingCall = null;
        if (Boolean.TRUE.equals(call.getBoolean("interactive", true))) session.cancelInteractive(generation);
        call.reject(reason.getMessage(), reason.code, reason);
    }

    @PluginMethod
    public void signIn(PluginCall call) {
        boolean interactive = Boolean.TRUE.equals(call.getBoolean("interactive", true));
        String email = call.getString("account");
        if (pendingCall != null) { call.reject("Google 登录正在进行，请稍候。", "GOOGLE_AUTH_TEMPORARY"); return; }
        int generation;
        if (interactive) {
            // Keep the last verified selection until Drive confirms the new account in setAccount.
            generation = session.beginInteractive();
            pendingCall = call;
            pendingGeneration = generation;
            pendingTokenRevision = session.snapshot().tokenRevision;
            if (email == null || email.isEmpty()) {
                try {
                    Intent picker = AccountPicker.newChooseAccountIntent(new AccountPicker.AccountChooserOptions.Builder()
                        .setAllowableAccountsTypes(Collections.singletonList("com.google"))
                        .setAlwaysShowAccountPicker(true).build());
                    getActivity().startActivityForResult(picker, 9026);
                } catch (Exception error) { reject(call, generation, error); }
                return;
            }
        } else generation = session.snapshot().generation;
        if (!interactive) {
            GoogleAuthSession.Snapshot saved = session.snapshot();
            if (email == null || email.isEmpty()) email = saved.account;
            if (email == null || saved.account == null || !email.equalsIgnoreCase(saved.account)) {
                reject(call, generation, GoogleAuthFailure.required());
                return;
            }
            email = saved.account;
            call.getData().put("account", email);
            String token = saved.validToken(System.currentTimeMillis());
            if (!Boolean.TRUE.equals(call.getBoolean("force", false)) && token != null) {
                call.resolve(new JSObject().put("accessToken", token));
                return;
            }
        }
        authorize(call, email, interactive, generation);
    }

    private void authorize(PluginCall call, String email, boolean interactive, int generation) {
        AuthorizationClient client;
        Task<Void> cleared;
        GoogleAuthSession.Snapshot authorization;
        boolean ownsRefresh;
        try {
            client = Identity.getAuthorizationClient(getActivity());
            GoogleAuthSession.Snapshot saved = session.snapshot();
            if (saved.refreshPending) throw GoogleAuthFailure.temporary();
            if (Boolean.TRUE.equals(call.getBoolean("force", false)) && saved.tokenToClear != null && saved.generation == generation) {
                // A rejected token must not remain available to playback while clearToken is in flight.
                authorization = session.beginTokenRefresh(saved.tokenToClear, generation);
                ownsRefresh = true;
                try { cleared = client.clearToken(ClearTokenRequest.builder().setToken(saved.tokenToClear).build()); }
                catch (Exception error) { session.endTokenRefresh(generation, authorization.tokenRevision); throw error; }
            } else {
                authorization = saved;
                ownsRefresh = false;
                cleared = Tasks.forResult(null);
            }
        } catch (Exception error) { reject(call, generation, error); return; }
        cleared.continueWithTask(task -> {
                if (task.isCanceled()) throw interactive ? GoogleAuthFailure.cancelled() : GoogleAuthFailure.temporary();
                if (!task.isSuccessful()) throw failure(task.getException());
                if (!session.isCurrent(generation)) throw GoogleAuthFailure.cancelled();
                return client.authorize(request(email));
            })
            .addOnSuccessListener(result -> {
                if (!session.isCurrent(generation)) { reject(call, generation, GoogleAuthFailure.cancelled()); return; }
                if (result.hasResolution()) {
                    session.endTokenRefresh(generation, authorization.tokenRevision);
                    if (!interactive) { reject(call, generation, GoogleAuthFailure.required()); return; }
                    pendingCall = call;
                    pendingGeneration = generation;
                    pendingTokenRevision = authorization.tokenRevision;
                    try {
                        getActivity().startIntentSenderForResult(result.getPendingIntent().getIntentSender(), 9027, null, 0, 0, 0);
                    } catch (Exception error) { reject(call, generation, error); }
                } else resolve(call, result, generation, authorization.tokenRevision, ownsRefresh);
            }).addOnFailureListener(error -> {
                if (ownsRefresh) session.endTokenRefresh(generation, authorization.tokenRevision);
                reject(call, generation, error);
            }).addOnCanceledListener(() -> {
                if (ownsRefresh) session.endTokenRefresh(generation, authorization.tokenRevision);
                reject(call, generation, interactive ? GoogleAuthFailure.cancelled() : GoogleAuthFailure.temporary());
            });
    }

    private void resolve(PluginCall call, AuthorizationResult result, int generation, int revision, boolean refreshOwner) {
        try {
            String email = call.getString("account");
            String token = cache(result, email, generation, revision, refreshOwner);
            call.resolve(new JSObject().put("accessToken", token));
        }
        catch (IOException error) { reject(call, generation, error); }
        finally {
            if (refreshOwner) session.endTokenRefresh(generation, revision);
            if (pendingCall == call) pendingCall = null;
        }
    }

    @Override
    protected void handleOnActivityResult(int requestCode, int resultCode, Intent data) {
        if ((requestCode != 9026 && requestCode != 9027) || pendingCall == null) return;
        PluginCall call = pendingCall;
        pendingCall = null;
        if (resultCode != Activity.RESULT_OK || data == null || !session.isCurrent(pendingGeneration)) {
            reject(call, pendingGeneration, GoogleAuthFailure.cancelled());
            return;
        }
        if (requestCode == 9026) {
            String email = data.getStringExtra(AccountManager.KEY_ACCOUNT_NAME);
            if (email == null || email.isEmpty()) { reject(call, pendingGeneration, GoogleAuthFailure.cancelled()); return; }
            call.getData().put("account", email);
            pendingCall = call;
            authorize(call, email, true, pendingGeneration);
            return;
        }
        try { resolve(call, Identity.getAuthorizationClient(getActivity()).getAuthorizationResultFromIntent(data), pendingGeneration, pendingTokenRevision, false); }
        catch (Exception error) { reject(call, pendingGeneration, error); }
    }

    @PluginMethod
    public void setAccount(PluginCall call) {
        String email = call.getString("email");
        try {
            synchronized (session) {
                session.requireVerifiedAccount(email);
                accountStore.write(email);
                session.rememberVerifiedAccount(email);
            }
            call.resolve();
        } catch (IOException error) {
            if (error instanceof GoogleAuthFailure) {
                GoogleAuthFailure reason = (GoogleAuthFailure) error;
                call.reject(reason.getMessage(), reason.code, reason);
            } else call.reject(error.getMessage(), "GOOGLE_ACCOUNT_SAVE_FAILED", error);
        }
    }

    @PluginMethod
    public void signOut(PluginCall call) {
        session.clear();
        if (pendingCall != null) { pendingCall.reject("Google 登录已取消。", "GOOGLE_LOGIN_CANCELLED"); pendingCall = null; }
        try { accountStore.clear(); call.resolve(); }
        catch (IOException error) { call.reject("无法清除已保存的 Google 账号。", error); }
    }

    // ExoPlayer calls this on its loading thread; Google Play services renews the in-memory token.
    public static String getPlaybackAccessToken(Context context) throws IOException {
        GoogleAuthSession.Snapshot saved = session.snapshot();
        if (saved.refreshPending) throw GoogleAuthFailure.temporary();
        String token = saved.validToken(System.currentTimeMillis());
        if (token != null) return token;
        if (saved.account == null) throw GoogleAuthFailure.required();
        try {
            AuthorizationResult result = Tasks.await(Identity.getAuthorizationClient(context).authorize(request(saved.account)), 30, TimeUnit.SECONDS);
            if (!session.isCurrent(saved.generation)) throw GoogleAuthFailure.cancelled();
            if (result.hasResolution()) throw GoogleAuthFailure.required();
            return cache(result, saved.account, saved.generation, saved.tokenRevision, false);
        } catch (InterruptedException error) {
            Thread.currentThread().interrupt();
            throw failure(error);
        } catch (Exception error) { throw failure(error); }
    }
}
