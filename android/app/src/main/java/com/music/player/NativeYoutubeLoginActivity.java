package com.music.player;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import androidx.activity.OnBackPressedCallback;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;

/** A separate first-party account page, never the Capacitor WebView containing the native bridge. */
public class NativeYoutubeLoginActivity extends AppCompatActivity {
    static final int RESULT_IMPORT_COOKIES = Activity.RESULT_FIRST_USER;
    private WebView web;
    private TextView status, origin;

    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private Button button(String text) {
        Button value = new Button(this); value.setText(text); value.setAllCaps(false); value.setMinHeight(dp(48)); return value;
    }
    private TextView text(String content, int size) {
        TextView value = new TextView(this); value.setText(content); value.setTextSize(size); value.setTextColor(Color.DKGRAY);
        value.setPadding(dp(12), dp(8), dp(12), dp(8)); return value;
    }

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setResult(Activity.RESULT_CANCELED);
        WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView()).setAppearanceLightStatusBars(true);
        LinearLayout page = new LinearLayout(this); page.setOrientation(LinearLayout.VERTICAL); page.setBackgroundColor(Color.WHITE);
        LinearLayout footer = new LinearLayout(this); footer.setOrientation(LinearLayout.VERTICAL);
        ViewCompat.setOnApplyWindowInsetsListener(page, (view, insets) -> {
            androidx.core.graphics.Insets bars = insets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout() | WindowInsetsCompat.Type.ime());
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom);
            footer.setVisibility(insets.isVisible(WindowInsetsCompat.Type.ime()) ? android.view.View.GONE : android.view.View.VISIBLE);
            return insets;
        });
        LinearLayout header = new LinearLayout(this);
        Button back = button("返回"); back.setOnClickListener(view -> finish()); header.addView(back);
        origin = text("YouTube 下载登录\nwww.youtube.com", 14);
        header.addView(origin, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1)); page.addView(header);
        page.addView(text("在此页面登录 YouTube 并完成验证，然后点击“完成并接入下载”。", 14));
        ProgressBar progress = new ProgressBar(this, null, android.R.attr.progressBarStyleHorizontal);
        page.addView(progress, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(3)));
        web = new WebView(this);
        WebSettings settings = web.getSettings(); settings.setJavaScriptEnabled(true); settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false); settings.setAllowContentAccess(false); settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        // Keep the real WebView user agent. Google's restrictions are not bypassed or disguised.
        CookieManager.getInstance().setAcceptCookie(true); CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView view, int value) { progress.setProgress(value); progress.setVisibility(value == 100 ? android.view.View.INVISIBLE : android.view.View.VISIBLE); }
        });
        web.setWebViewClient(new WebViewClient() {
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) { return !allowed(request.getUrl().toString()); }
            @Override public boolean shouldOverrideUrlLoading(WebView view, String address) { return !allowed(address); }
            private boolean allowed(String address) {
                if (NativeYoutubeLoginPolicy.canLoad(address)) return true;
                status.setText("此登录页面只打开 YouTube 和 Google 官方页面。"); return false;
            }
            @Override public void onPageStarted(WebView view, String address, android.graphics.Bitmap icon) {
                if (!NativeYoutubeLoginPolicy.canLoad(address)) { view.stopLoading(); status.setText("无法打开此登录链接，请返回 YouTube 页面。"); return; }
                origin.setText("YouTube 下载登录\n" + NativeYoutubeLoginPolicy.host(address));
                if (address.contains("disallowed_useragent")) status.setText("Google 限制了此网页登录，请在浏览器完成登录后导入登录文件。");
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) status.setText("页面未能打开，请检查网络后刷新，或导入浏览器登录文件。");
            }
        });
        page.addView(web, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1));
        status = text("如果 Google 不允许在此登录，请使用下面的浏览器登录文件导入。", 12); footer.addView(status);
        Button connect = button("完成并接入下载"); connect.setOnClickListener(view -> {
            try {
                CookieManager cookies = CookieManager.getInstance();
                NativeYoutubeCookies.fromHeaders(cookies.getCookie("https://www.youtube.com/"), cookies.getCookie("https://music.youtube.com/"), cookies.getCookie("https://m.youtube.com/"));
                cookies.flush(); setResult(Activity.RESULT_OK); finish();
            } catch (Exception error) { status.setText("还没有检测到 YouTube 登录。请在上方登录完成，或导入浏览器登录文件。"); }
        }); footer.addView(connect);
        LinearLayout alternatives = new LinearLayout(this);
        Button refresh = button("刷新页面"); refresh.setOnClickListener(view -> web.loadUrl(NativeYoutubeLoginPolicy.START_URL));
        alternatives.addView(refresh, new LinearLayout.LayoutParams(0, dp(48), 1));
        Button importCookies = button("导入登录文件"); importCookies.setOnClickListener(view -> { setResult(RESULT_IMPORT_COOKIES); finish(); });
        alternatives.addView(importCookies, new LinearLayout.LayoutParams(0, dp(48), 1)); footer.addView(alternatives);
        Button external = button("在外部打开 YouTube ↗"); external.setOnClickListener(view -> {
            try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(NativeYoutubeLoginPolicy.START_URL))); }
            catch (Exception error) { status.setText("没有可打开 YouTube 的应用，请导入已有的登录文件。"); }
        }); footer.addView(external); page.addView(footer);
        setContentView(page); ViewCompat.requestApplyInsets(page);
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override public void handleOnBackPressed() { if (web.canGoBack()) web.goBack(); else finish(); }
        });
        web.loadUrl(NativeYoutubeLoginPolicy.START_URL);
    }

    @Override protected void onPause() { if (web != null) web.onPause(); super.onPause(); }
    @Override protected void onResume() { super.onResume(); if (web != null) web.onResume(); }
    @Override protected void onDestroy() {
        if (web != null) {
            web.stopLoading();
            if (web.getParent() instanceof ViewGroup) ((ViewGroup) web.getParent()).removeView(web);
            web.destroy(); web = null;
        }
        super.onDestroy();
    }
}
