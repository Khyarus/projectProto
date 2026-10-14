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
    lateinit var models: ModelManager
    lateinit var wake: WakeWord
    lateinit var face: FaceTracker

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
        models = ModelManager(this)
        wake = WakeWord(
            this,
            onWake = { emit("protogenWake", JSONObject().put("type", "wake")) },
            onDebug = { emit("protogenWake", JSONObject().put("type", "debug").put("text", it)) },
        )
        face = FaceTracker(
            this,
            onFace = { x, y, size -> emit("protogenFace", JSONObject().put("x", x).put("y", y).put("size", size)) },
            onLost = { emit("protogenFace", JSONObject().put("lost", true)) },
        )
        bridge = Bridge(this)
        web.addJavascriptInterface(bridge, "ProtogenNative")
        setContentView(web)
        web.loadUrl("https://appassets.androidplatform.net/assets/web/index.html")

        // Botão voltar não sai do app
        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {}
        })

        val missing = arrayOf(Manifest.permission.RECORD_AUDIO, Manifest.permission.CAMERA)
            .filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isNotEmpty()) requestPermissions(missing.toTypedArray(), 1)

        Kiosk.enter(this)
        startUpdateLoop()
        setupModels()
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        // a interface religa câmera/escuta quando recebe este aviso
        sys("permissions", "permissões atualizadas")
    }

    /**
     * Configuração inicial: baixa sozinho o que o catálogo (web/models.json) define como padrão.
     * - modelo da palavra de ativação (pequeno): sempre
     * - LLM padrão (~1-2 GB): só em rede sem franquia (Wi-Fi); senão espera o comando /baixar
     */
    private fun setupModels() {
        lifecycleScope.launch {
            models.refreshCatalog()
            models.wakeModel?.let { m ->
                if (models.isInstalled(m)) wake.load(models.path(m))
                else downloadModel(m.id)
            }
            val llm = models.get(models.selectedLlm)
            if (llm != null && !models.isInstalled(llm)) {
                if (models.isUnmetered()) downloadModel(llm.id)
                else sys("models", "modelo ${llm.name} não instalado. Use /baixar ${llm.id} no Wi-Fi.")
            }
        }
    }

    fun downloadModel(id: String) {
        val m = models.get(id) ?: return sys("models", "modelo desconhecido: $id")
        if (models.jobs[id]?.isActive == true) return sys("models", "${m.id} já está baixando")
        models.jobs[id] = lifecycleScope.launch {
            sys("download", "baixando ${m.name}...")
            var last = -1
            runCatching {
                models.download(m) { pct ->
                    if (pct / 5 != last / 5) {
                        last = pct
                        emit("protogenSys", JSONObject().put("type", "download").put("id", id).put("pct", pct)
                            .put("text", "baixando ${m.id}: $pct%"))
                    }
                }
            }.onSuccess {
                sys("download", "${m.name} instalado")
                if (m.kind == "wake") wake.load(models.path(m))
            }.onFailure {
                sys("download", "falha ao baixar ${m.id}: ${it.message}")
            }
        }
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
        wake.destroy()
        face.destroy()
        super.onDestroy()
    }

    private fun hideSystemBars() {
        WindowInsetsControllerCompat(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
    }
}
