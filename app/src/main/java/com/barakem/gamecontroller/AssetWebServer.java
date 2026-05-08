package com.barakem.gamecontroller;

import android.content.res.AssetManager;
import android.util.Log;
import java.io.IOException;
import java.io.InputStream;
import java.util.HashMap;
import java.util.Map;
import fi.iki.elonen.NanoHTTPD;

public class AssetWebServer extends NanoHTTPD {
    private static final String TAG = "GameCtrlServer";
    private static final Map<String, String> MIME = new HashMap<>();
    static {
        MIME.put("html", "text/html; charset=utf-8");
        MIME.put("js",   "application/javascript; charset=utf-8");
        MIME.put("css",  "text/css; charset=utf-8");
        MIME.put("json", "application/json; charset=utf-8");
        MIME.put("wasm", "application/wasm");
        MIME.put("png",  "image/png");
        MIME.put("jpg",  "image/jpeg");
    }
    private final AssetManager assets;

    public AssetWebServer(int port, AssetManager assets) {
        super("localhost", port);
        this.assets = assets;
    }

    @Override
    public Response serve(IHTTPSession session) {
        String path = session.getUri();
        if (path.equals("/") || path.isEmpty()) path = "/launcher.html";
        String assetPath = path.startsWith("/") ? path.substring(1) : path;
        String ext = "";
        int dot = assetPath.lastIndexOf('.');
        if (dot >= 0) ext = assetPath.substring(dot + 1).toLowerCase();
        String mime = MIME.containsKey(ext) ? MIME.get(ext) : "application/octet-stream";
        try {
            InputStream is = assets.open(assetPath);
            return newChunkedResponse(Response.Status.OK, mime, is);
        } catch (IOException e) {
            Log.w(TAG, "Not found: " + assetPath);
            return newFixedLengthResponse(Response.Status.NOT_FOUND, "text/plain", "Not found");
        }
    }
}
