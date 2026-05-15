package com.barakem.gamecontroller;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.IOException;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.util.ArrayList;
import java.util.List;

public class MainActivity extends Activity {

    private static final String TAG        = "GameController";
    private static final int    ASSET_PORT = 8093;
    private static final int    UDP_BALLOON = 8444;
    private static final int    UDP_GESTURE = 8445;
    private static final int    UDP_TETRIS  = 8446;

    private WebView        webView;
    private AssetWebServer assetServer;

    private DatagramSocket udpBalloon, udpGesture, udpTetris;
    private Thread         udpBalloonThread, udpGestureThread, udpTetrisThread;

    private final List<DiscoveredGame> discoveredGames = new ArrayList<>();
    private final Object               gamesLock       = new Object();

    static class DiscoveredGame {
        String type, ip;
        int port;
        DiscoveredGame(String t, String i, int p) { type = t; ip = i; port = p; }
    }

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
            | View.SYSTEM_UI_FLAG_FULLSCREEN
            | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
            | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
            | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);

        requestPermissions();

        assetServer = new AssetWebServer(ASSET_PORT, getAssets());
        try { assetServer.start(); }
        catch (IOException e) { Log.e(TAG, "Asset server: " + e.getMessage()); }

        webView = findViewById(R.id.webview);
        setupWebView();
        webView.loadUrl("http://localhost:" + ASSET_PORT + "/launcher.html");

        startUdpListeners();
    }

    private void requestPermissions() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            List<String> perms = new ArrayList<>();
            if (checkSelfPermission(android.Manifest.permission.CAMERA)
                    != PackageManager.PERMISSION_GRANTED)
                perms.add(android.Manifest.permission.CAMERA);
            if (checkSelfPermission(android.Manifest.permission.RECORD_AUDIO)
                    != PackageManager.PERMISSION_GRANTED)
                perms.add(android.Manifest.permission.RECORD_AUDIO);
            if (!perms.isEmpty())
                requestPermissions(perms.toArray(new String[0]), 1);
        }
    }

    private void startUdpListeners() {
        udpBalloonThread = startUdpThread("HVGAME",       UDP_BALLOON);
        udpGestureThread = startUdpThread("GESTURE_GAME", UDP_GESTURE);
        udpTetrisThread  = startUdpThread("TETRIS_GAME",  UDP_TETRIS);
    }

    private Thread startUdpThread(final String prefix, final int port) {
        Thread t = new Thread(() -> {
            try {
                DatagramSocket sock = new DatagramSocket(port);
                if      (prefix.equals("HVGAME"))        udpBalloon = sock;
                else if (prefix.equals("GESTURE_GAME"))  udpGesture = sock;
                else                                     udpTetris  = sock;

                byte[] buf = new byte[256];
                while (!Thread.currentThread().isInterrupted()) {
                    DatagramPacket pkt = new DatagramPacket(buf, buf.length);
                    sock.receive(pkt);
                    String msg = new String(pkt.getData(), 0, pkt.getLength(), "UTF-8");
                    if (msg.startsWith(prefix + ":")) {
                        String[] parts = msg.split(":");
                        if (parts.length >= 3) {
                            String ip    = parts[1];
                            // Reject non-IPv4 values to prevent JS injection via evaluateJavascript
                            if (!ip.matches("\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}\\.\\d{1,3}")) {
                                Log.w(TAG, "UDP[" + port + "]: invalid IP ignored: " + ip);
                                continue;
                            }
                            int    wsPort = Integer.parseInt(parts[2].trim());
                            addOrUpdateGame(prefix, ip, wsPort);
                        }
                    }
                }
                sock.close();
            } catch (Exception e) {
                if (!Thread.currentThread().isInterrupted())
                    Log.w(TAG, "UDP[" + port + "]: " + e.getMessage());
            }
        }, "udp-" + port);
        t.setDaemon(true);
        t.start();
        return t;
    }

    private void addOrUpdateGame(String type, String ip, int port) {
        boolean shouldNotify;
        synchronized (gamesLock) {
            DiscoveredGame found = null;
            for (DiscoveredGame g : discoveredGames) {
                if (g.type.equals(type)) { found = g; break; }
            }
            if (found == null) {
                discoveredGames.add(new DiscoveredGame(type, ip, port));
                shouldNotify = true;
            } else {
                // Notify on IP/port change so the controller reconnects to the new address.
                // Repeated broadcasts with the same address are silently ignored to avoid spam.
                shouldNotify = !found.ip.equals(ip) || found.port != port;
                found.ip = ip; found.port = port;
            }
        }
        if (shouldNotify) {
            final String json = gameJson(type, ip, port);
            runOnUiThread(() -> webView.evaluateJavascript(
                "if(window.onGameDiscovered)window.onGameDiscovered(" + json + ");", null));
        }
    }

    private String gameJson(String type, String ip, int port) {
        return "{\"type\":\"" + type + "\",\"ip\":\"" + ip + "\",\"port\":" + port + "}";
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void setupWebView() {
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP)
            s.setMixedContentMode(WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE);

        webView.addJavascriptInterface(new Bridge(), "AndroidBridge");
        webView.setWebViewClient(new WebViewClient());
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onPermissionRequest(PermissionRequest req) {
                runOnUiThread(() -> req.grant(req.getResources()));
            }
        });
    }

    private class Bridge {
        @JavascriptInterface
        public String getDiscoveredGamesJson() {
            synchronized (gamesLock) {
                StringBuilder sb = new StringBuilder("[");
                for (int i = 0; i < discoveredGames.size(); i++) {
                    if (i > 0) sb.append(",");
                    DiscoveredGame g = discoveredGames.get(i);
                    sb.append(gameJson(g.type, g.ip, g.port));
                }
                return sb.append("]").toString();
            }
        }

        @JavascriptInterface
        public int getAssetPort() { return ASSET_PORT; }

        @JavascriptInterface
        public void closeApp() { runOnUiThread(() -> finish()); }
    }

    @Override
    protected void onResume() {
        super.onResume();
        // Restart UDP listeners so we pick up whichever TV game just came to foreground.
        // This also lets the controller reconnect automatically after the phone was backgrounded.
        synchronized (gamesLock) { discoveredGames.clear(); }
        if (udpBalloonThread == null || !udpBalloonThread.isAlive())
            udpBalloonThread = startUdpThread("HVGAME",       UDP_BALLOON);
        if (udpGestureThread == null || !udpGestureThread.isAlive())
            udpGestureThread = startUdpThread("GESTURE_GAME", UDP_GESTURE);
        if (udpTetrisThread  == null || !udpTetrisThread.isAlive())
            udpTetrisThread  = startUdpThread("TETRIS_GAME",  UDP_TETRIS);
        webView.onResume();
    }

    @Override
    protected void onPause() {
        webView.onPause();
        // Stop UDP listeners while backgrounded — avoids acting on stale broadcasts.
        for (Thread t : new Thread[]{udpBalloonThread, udpGestureThread, udpTetrisThread})
            if (t != null) t.interrupt();
        for (DatagramSocket s : new DatagramSocket[]{udpBalloon, udpGesture, udpTetris})
            if (s != null) s.close();
        udpBalloon = null; udpGesture = null; udpTetris = null;
        udpBalloonThread = null; udpGestureThread = null; udpTetrisThread = null;
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        for (Thread t : new Thread[]{udpBalloonThread, udpGestureThread, udpTetrisThread})
            if (t != null) t.interrupt();
        for (DatagramSocket s : new DatagramSocket[]{udpBalloon, udpGesture, udpTetris})
            if (s != null) s.close();
        if (assetServer != null) assetServer.stop();
        webView.destroy();
        super.onDestroy();
    }
}
