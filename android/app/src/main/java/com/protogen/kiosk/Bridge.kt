package com.protogen.kiosk

import android.webkit.JavascriptInterface
import org.json.JSONObject

/**
 * Exposto ao JavaScript como `window.ProtogenNative`.
 * Métodos @JavascriptInterface rodam numa thread do WebView, não na principal.
 */
class Bridge(private val act: MainActivity) {

    private val ears = Ears(act) { ev -> act.emit("protogenEars", ev) }

    // ---------- ouvidos (reconhecedor do Android) ----------
    @JavascriptInterface
    fun startListening(lang: String) = act.runOnUiThread { ears.start(lang) }

    @JavascriptInterface
    fun stopListening() = act.runOnUiThread { ears.stop() }

    // ---------- palavra de ativação offline (Vosk) ----------
    @JavascriptInterface
    fun voskReady(): Boolean = act.wake.loaded

    @JavascriptInterface
    fun voskListen(on: Boolean) = act.runOnUiThread { act.wake.setEnabled(on) }

    @JavascriptInterface
    fun wakeDebug(on: Boolean) { act.wake.debug = on }

    @JavascriptInterface
    fun wakeThreshold(v: Double) { act.wake.threshold = v }

    // ---------- câmera ----------
    @JavascriptInterface
    fun faceTracking(on: Boolean) = act.runOnUiThread { if (on) act.face.start() else act.face.stop() }

    // ---------- modelos ----------
    @JavascriptInterface
    fun models(): String = act.models.toJson()

    @JavascriptInterface
    fun downloadModel(id: String) = act.runOnUiThread { act.downloadModel(id) }

    @JavascriptInterface
    fun selectModel(id: String): Boolean {
        val m = act.models.get(id) ?: return false
        if (m.kind != "llm") return false
        act.models.selectedLlm = id
        act.runOnUiThread { act.loadBrain() }
        return true
    }

    @JavascriptInterface
    fun deleteModel(id: String): Boolean {
        val m = act.models.get(id) ?: return false
        if (act.models.jobs[id]?.isActive == true) return false
        act.models.delete(m)
        return true
    }

    // ---------- cérebro (llama.cpp) ----------
    @JavascriptInterface
    fun hasBrain(): Boolean = Llm.loadedPath != null

    @JavascriptInterface
    fun ask(id: Int, messagesJson: String) {
        fun ev(type: String, text: String? = null) =
            act.emit("protogenBrain", JSONObject().put("id", id).put("type", type).apply { if (text != null) put("text", text) })
        Llm.generate(messagesJson, onToken = { ev("token", it) }, done = { err -> if (err == null) ev("done") else ev("error", err) })
    }

    @JavascriptInterface
    fun cancel(id: Int) = Llm.cancel()

    @JavascriptInterface
    fun modelName(): String = act.models.installedLlm()?.id ?: "nenhum"

    // ---------- sistema ----------
    @JavascriptInterface
    fun appVersion(): String = BuildConfig.VERSION_NAME

    @JavascriptInterface
    fun isKiosk(): Boolean = Kiosk.isOwner(act)

    @JavascriptInterface
    fun checkUpdate() = act.checkUpdate(silentIfNone = false)

    /** Sai do modo travado até o app ser reaberto. */
    @JavascriptInterface
    fun exitKiosk(pin: String): Boolean {
        if (pin != BuildConfig.KIOSK_PIN) return false
        act.runOnUiThread { Kiosk.exit(act) }
        return true
    }

    /** Remove o app como dono do aparelho (permite desinstalar). Irreversível sem novo adb. */
    @JavascriptInterface
    fun releaseOwner(pin: String): Boolean {
        if (pin != BuildConfig.KIOSK_PIN) return false
        act.runOnUiThread { Kiosk.releaseOwner(act) }
        return true
    }

    fun destroy() = ears.destroy()
}
