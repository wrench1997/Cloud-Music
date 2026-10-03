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
    private static volatile String accessToken;
    private static volatile long expiresAt;
    private static volatile String accountEmail;
    private static volatile int accountGeneration;
    private PluginCall pendingCall;
    private int pendingGeneration;

    private static AuthorizationRequest request(String email) {
        AuthorizationRequest.Builder builder = AuthorizationRequest.builder()
            .setRequestedScopes(Arrays.asList(new Scope(DRIVE_SCOPES.get(0)), new Scope(DRIVE_SCOPES.get(1))));
        if (email != null && !email.isEmpty()) builder.setAccount(new Account(email, "com.google"));
        return builder.build();
    }

    private static synchronized String cache(AuthorizationResult result, int generation) throws IOException {
        if (generation != accountGeneration) throw new IOException("Google 登录已取消。");
        String token = result.getAccessToken();
        if (token == null || !result.getGrantedScopes().containsAll(DRIVE_SCOPES)) {
            throw new IOException("请允许读取 Google Drive 目录和音乐，以及保存应用曲库。");
        }
        accessToken = token;
        expiresAt = System.currentTimeMillis() + TimeUnit.MINUTES.toMillis(45);
        return token;
    }

    @PluginMethod
    public void signIn(PluginCall call) {
        boolean interactive = Boolean.TRUE.equals(call.getBoolean("interactive", true));
        String email = call.getString("account");
        if (pendingCall != null) { call.reject("Google 登录正在进行，请稍候。"); return; }
        if (interactive) {
            accountGeneration++;
            accessToken = null;
            expiresAt = 0;
            accountEmail = null;
            pendingCall = call;
            pendingGeneration = accountGeneration;
            if (email == null || email.isEmpty()) {
                try {
                    Intent picker = AccountPicker.newChooseAccountIntent(new AccountPicker.AccountChooserOptions.Builder()
                        .setAllowableAccountsTypes(Collections.singletonList("com.google"))
                        .setAlwaysShowAccountPicker(true).build());
                    getActivity().startActivityForResult(picker, 9026);
                } catch (Exception error) { pendingCall = null; call.reject("无法选择 Google 账号，请检查 Google Play 服务。", error); }
                return;
            }
        }
        if (!interactive && (email == null || email.equals(accountEmail)) && !Boolean.TRUE.equals(call.getBoolean("force", false))
                && accessToken != null && expiresAt > System.currentTimeMillis()) {
            call.resolve(new JSObject().put("accessToken", accessToken));
            return;
        }
        int generation = accountGeneration;
        authorize(call, email, interactive, generation);
    }

    private void authorize(PluginCall call, String email, boolean interactive, int generation) {
        AuthorizationClient client = Identity.getAuthorizationClient(getActivity());
        Task<Void> cleared = Boolean.TRUE.equals(call.getBoolean("force", false)) && accessToken != null
            ? client.clearToken(ClearTokenRequest.builder().setToken(accessToken).build()) : Tasks.forResult(null);
        cleared.continueWithTask(task -> {
                if (!task.isSuccessful()) throw new IOException("无法刷新 Google 授权。", task.getException());
                if (generation != accountGeneration) throw new IOException("Google 登录已取消。");
                return client.authorize(request(email));
            })
            .addOnSuccessListener(result -> {
                if (generation != accountGeneration) { call.reject("Google 登录已取消。"); return; }
                if (result.hasResolution()) {
                    if (!interactive) { call.reject("请重新连接 Google 账号。", "GOOGLE_AUTH_REQUIRED"); return; }
                    pendingCall = call;
                    pendingGeneration = generation;
                    try {
                        getActivity().startIntentSenderForResult(result.getPendingIntent().getIntentSender(), 9027, null, 0, 0, 0);
                    } catch (Exception error) { pendingCall = null; call.reject("无法打开 Google 授权窗口。", error); }
                } else resolve(call, result, generation);
            }).addOnFailureListener(error -> {
                if (pendingCall == call) pendingCall = null;
                call.reject("Google 授权失败，请检查 Google Play 服务、应用 OAuth 配置和网络。", "GOOGLE_AUTH_REQUIRED", error);
            });
    }

    private void resolve(PluginCall call, AuthorizationResult result, int generation) {
        try {
            String email = call.getString("account");
            String token = cache(result, generation);
            if (email != null) accountEmail = email;
            call.resolve(new JSObject().put("accessToken", token));
        }
        catch (IOException error) { call.reject(error.getMessage(), "GOOGLE_AUTH_REQUIRED", error); }
        finally { if (pendingCall == call) pendingCall = null; }
    }

    @Override
    protected void handleOnActivityResult(int requestCode, int resultCode, Intent data) {
        if ((requestCode != 9026 && requestCode != 9027) || pendingCall == null) return;
        PluginCall call = pendingCall;
        pendingCall = null;
        if (resultCode != Activity.RESULT_OK || data == null || pendingGeneration != accountGeneration) {
            call.reject("Google 登录已取消。");
            return;
        }
        if (requestCode == 9026) {
            String email = data.getStringExtra(AccountManager.KEY_ACCOUNT_NAME);
            if (email == null || email.isEmpty()) { call.reject("没有选择 Google 账号。"); return; }
            call.getData().put("account", email);
            pendingCall = call;
            authorize(call, email, true, pendingGeneration);
            return;
        }
        try { resolve(call, Identity.getAuthorizationClient(getActivity()).getAuthorizationResultFromIntent(data), pendingGeneration); }
        catch (Exception error) { call.reject("Google 授权未完成，请重试。", error); }
    }

    @PluginMethod
    public void setAccount(PluginCall call) {
        accountEmail = call.getString("email");
        call.resolve();
    }

    @PluginMethod
    public void signOut(PluginCall call) {
        accountGeneration++;
        accessToken = null;
        expiresAt = 0;
        accountEmail = null;
        if (pendingCall != null) { pendingCall.reject("Google 登录已取消。"); pendingCall = null; }
        call.resolve();
    }

    // ExoPlayer calls this on its loading thread; Google Play services renews the in-memory token.
    public static String getPlaybackAccessToken(Context context) throws IOException {
        if (accessToken != null && expiresAt > System.currentTimeMillis()) return accessToken;
        if (accountEmail == null) throw new IOException("请重新连接 Google 账号。");
        int generation = accountGeneration;
        try {
            AuthorizationResult result = Tasks.await(Identity.getAuthorizationClient(context).authorize(request(accountEmail)), 30, TimeUnit.SECONDS);
            if (generation != accountGeneration || result.hasResolution()) throw new IOException("请重新连接 Google 账号。");
            return cache(result, generation);
        } catch (Exception error) { throw new IOException("Google 曲库授权已失效，请重新连接账号。", error); }
    }
}
