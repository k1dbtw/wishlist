package uz.k1d.stash;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.content.ContentValues;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.webkit.JavascriptInterface;
import android.widget.Toast;
import java.io.OutputStream;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * A thin shell around the stash web app: one full-screen WebView pointed at the
 * site the person deployed. The address is asked once (assets/setup.html) and kept
 * in SharedPreferences; SITE_URL can be baked in at build time instead.
 */
public class MainActivity extends Activity {
    private static final String PREFS = "stash";
    private static final String KEY_URL = "site";
    private static final String SETUP = "file:///android_asset/setup.html";
    private static final String OFFLINE = "file:///android_asset/offline.html";

    private WebView web;
    private String base;   // e.g. https://my-stash.netlify.app

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        web = new WebView(this);
        setContentView(web);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setAllowFileAccess(false);
        s.setUserAgentString(s.getUserAgentString() + " StashAndroid/1");
        CookieManager.getInstance().setAcceptCookie(true);

        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new Client());
        // the web app calls StashAndroid.save() for exports: <a download> does nothing inside a WebView
        web.addJavascriptInterface(new Bridge(), "StashAndroid");

        base = getSharedPreferences(PREFS, MODE_PRIVATE).getString(KEY_URL, Config.SITE_URL);
        if (state != null) web.restoreState(state);
        else open(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        open(intent);
    }

    /** Launch or "share to stash": shared text goes to the app as ?text=, which it files itself. */
    private void open(Intent intent) {
        if (base == null || base.isEmpty()) { web.loadUrl(SETUP); return; }
        String url = base + "/";
        if (intent != null && Intent.ACTION_SEND.equals(intent.getAction())) {
            String text = intent.getStringExtra(Intent.EXTRA_TEXT);
            String subject = intent.getStringExtra(Intent.EXTRA_SUBJECT);
            if (text != null && !text.isEmpty()) {
                url += "?text=" + Uri.encode(text) + (subject != null ? "&title=" + Uri.encode(subject) : "");
            }
        }
        web.loadUrl(url);
    }

    private boolean isOwn(Uri u) {
        if (base == null || base.isEmpty()) return false;
        Uri b = Uri.parse(base);
        return b.getHost() != null && b.getHost().equalsIgnoreCase(u.getHost()) && "https".equals(u.getScheme());
    }

    private void saveSite(String raw) {
        String v = raw == null ? "" : raw.trim();
        if (!v.startsWith("http://") && !v.startsWith("https://")) v = "https://" + v;
        Uri u = Uri.parse(v);
        if (u.getHost() == null || !u.getHost().contains(".")) { web.loadUrl(SETUP + "#bad"); return; }
        base = "https://" + u.getHost().toLowerCase();
        getSharedPreferences(PREFS, MODE_PRIVATE).edit().putString(KEY_URL, base).apply();
        open(null);
    }

    private class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            Uri u = Uri.parse(url);
            String scheme = u.getScheme() == null ? "" : u.getScheme();
            if ("stash".equals(scheme)) {
                // commands from the bundled pages: stash://site?u=..., stash://retry, stash://setup
                String host = u.getHost() == null ? "" : u.getHost();
                if (host.equals("site")) saveSite(u.getQueryParameter("u"));
                else if (host.equals("setup")) view.loadUrl(SETUP);
                else open(null);
                return true;
            }
            if (isOwn(u)) return false;
            // everything else (shops, links in wishes, mail, phone) opens outside the app
            try {
                startActivity(new Intent(Intent.ACTION_VIEW, u).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
            } catch (ActivityNotFoundException ignored) { }
            return true;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            CookieManager.getInstance().flush();
        }

        // the pre-23 signature; WebView calls it for main-frame failures on every version
        @Override
        @SuppressWarnings("deprecation")
        public void onReceivedError(WebView view, int code, String description, String failingUrl) {
            if (failingUrl != null && failingUrl.startsWith("http")) view.loadUrl(OFFLINE);
        }
    }

    private class Bridge {
        @JavascriptInterface
        public void save(final String name, final String text, final String type) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() { saveDownload(name, text, type); }
            });
        }
    }

    private void saveDownload(String name, String text, String type) {
        if (Build.VERSION.SDK_INT < 29) {
            Toast.makeText(this, "Сохранение файлов работает с Android 10. Сделай экспорт с компьютера.", Toast.LENGTH_LONG).show();
            return;
        }
        String file = (name == null ? "stash.txt" : name).replaceAll("[^\\w.-]", "_");
        try {
            ContentValues v = new ContentValues();
            v.put(MediaStore.MediaColumns.DISPLAY_NAME, file);
            v.put(MediaStore.MediaColumns.MIME_TYPE, type == null ? "text/plain" : type.split(";")[0].trim());
            v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
            Uri uri = getContentResolver().insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
            if (uri == null) throw new java.io.IOException("insert failed");
            OutputStream os = getContentResolver().openOutputStream(uri);
            try { os.write(text.getBytes("UTF-8")); } finally { os.close(); }
            Toast.makeText(this, "Сохранено в «Загрузки»: " + file, Toast.LENGTH_LONG).show();
        } catch (Exception e) {
            Toast.makeText(this, "Не получилось сохранить файл", Toast.LENGTH_LONG).show();
        }
    }

    @Override
    public void onBackPressed() {
        // close an open sheet first, then step back in history, then leave
        web.evaluateJavascript(
            "(function(){var d=document.querySelector('dialog[open]');if(d){d.close();return 1}return 0})()",
            new ValueCallback<String>() {
                @Override
                public void onReceiveValue(String closed) {
                    if ("1".equals(closed)) return;
                    String cur = web.getUrl();
                    if (web.canGoBack() && cur != null && !cur.startsWith(OFFLINE)) web.goBack();
                    else moveTaskToBack(true);
                }
            });
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onPause() {
        super.onPause();
        CookieManager.getInstance().flush();
        web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }
}
