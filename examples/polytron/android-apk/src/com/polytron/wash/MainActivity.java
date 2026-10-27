package com.polytron.wash;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import java.io.InputStream;

public class MainActivity extends Activity {
    private WebView web;
    private PolytronBle ble;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        // Immersive dark status/navigation bars matching the app theme
        getWindow().getDecorView().setBackgroundColor(Color.parseColor("#081110"));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getWindow().getInsetsController().setSystemBarsAppearance(
                    0, WindowInsets.Type.statusBars() | WindowInsets.Type.navigationBars());
        }

        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#081110"));
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setAllowFileAccess(false); // only custom-intercepted assets served

        ble = new PolytronBle(this, web);
        web.addJavascriptInterface(ble, "PolytronNative");

        // Serve bundled assets under a local origin with no external network
        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, String url) {
                if (url.startsWith("https://appassets.androidplatform.net/") ||
                    url.startsWith("http://localhost/") ||
                    url.startsWith("https://localhost/")) {
                    String path = url.replaceFirst("^https?://[^/]+/", "");
                    if (path.isEmpty() || path.equals("index.html")) {
                        return assetResponse("index.html", "text/html");
                    }
                    if (path.equals("preview.js")) {
                        return assetResponse("preview.js", "text/javascript");
                    }
                }
                return super.shouldInterceptRequest(view, url);
            }
        });

        // Request BLE runtime permissions on Android 12+
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            if (checkSelfPermission("android.permission.BLUETOOTH_SCAN") != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(new String[]{
                        "android.permission.BLUETOOTH_SCAN",
                        "android.permission.BLUETOOTH_CONNECT"
                }, 101);
            }
        }

        web.loadUrl("https://localhost/index.html");
    }

    private WebResourceResponse assetResponse(String asset, String mime) {
        try {
            InputStream in = getAssets().open(asset);
            java.util.Map<String, String> headers = new java.util.HashMap<>();
            headers.put("Access-Control-Allow-Origin", "*");
            headers.put("Cache-Control", "no-cache");
            return new WebResourceResponse(mime, "utf-8", 200, "OK", headers, in);
        } catch (Exception e) {
            return new WebResourceResponse("text/plain", "utf-8", 404, "Not Found", null, null);
        }
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        super.onDestroy();
        if (ble != null) ble.shutdown();
        if (web != null) web.destroy();
    }
}
