package com.protogen.kiosk

import android.Manifest
import android.annotation.SuppressLint
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Bundle
import android.view.WindowManager
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.lifecycleScope
import androidx.webkit.WebViewAssetLoader
import androidx.webkit.WebViewClientCompat
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject

class MainActivity : ComponentActivity() {

    private lateinit var web: WebView
    private lateinit var bridge: Bridge

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        WindowCompat.setDecorFitsSystemWindows(window, false)
        hideSystemBars()

        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        // Serve assets/web como https://appassets.androidplatform.net/assets/web/...
        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        web = WebView(this).apply {
            setBackgroundColor(Color.BLACK)
            settings.javaScriptEnabled = true
            settings.domStorageEnabled = true
            settings.mediaPlaybackRequiresUserGesture = false
            webViewClient = object : WebViewClientCompat() {
                override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                    loader.shouldInterceptRequest(request.url)
            }
        }
        bridge = Bridge(this, web)
        web.addJavascriptInterface(bridge, "ProtogenNative")
        setContentView(web)
        web.loadUrl("https://appassets.androidplatform.net/assets/web/index.html")

        // Botão voltar não sai do app
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {}
        })

        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 1)
        }

        Kiosk.enter(this)
        startUpdateLoop()
    }

    /** Verifica atualização ao abrir e depois a cada 6 horas. */
    private fun startUpdateLoop() {
        lifecycleScope.launch {
            delay(15_000) // deixa o app terminar de subir
            while (true) {
                checkUpdate(silentIfNone = true)
                delay(6 * 60 * 60 * 1000L)
            }
        }
    }

    fun checkUpdate(silentIfNone: Boolean) {
        lifecycleScope.launch {
            val result = runCatching { Updater.check() }
            val rel = result.getOrNull()
            when {
                result.isFailure -> if (!silentIfNone) sys("update", "falha ao verificar: ${result.exceptionOrNull()?.message}")
                rel == null -> if (!silentIfNone) sys("update", "versão ${BuildConfig.VERSION_NAME} já é a mais nova")
                else -> {
                    sys("update", "baixando versão ${rel.version}...")
                    runCatching { Updater.downloadAndInstall(this@MainActivity, rel) }
                        .onFailure { sys("update", "falha na atualização: ${it.message}") }
                }
            }
        }
    }

    /** Mensagem de sistema para a interface (aparece como legenda). */
    fun sys(type: String, text: String) {
        emit("protogenSys", JSONObject().put("type", type).put("text", text))
    }

    fun emit(fn: String, payload: JSONObject) {
        runOnUiThread {
            web.evaluateJavascript("window.$fn && window.$fn($payload)", null)
        }
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) hideSystemBars()
    }

    override fun onResume() {
        super.onResume()
        Kiosk.enter(this)
    }

    override fun onDestroy() {
        bridge.destroy()
        super.onDestroy()
    }

    private fun hideSystemBars() {
        WindowInsetsControllerCompat(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
    }
}
