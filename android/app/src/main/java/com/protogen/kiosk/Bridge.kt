package com.protogen.kiosk

import android.webkit.JavascriptInterface
import android.webkit.WebView
import org.json.JSONObject

/**
 * Exposto ao JavaScript como `window.ProtogenNative`.
 * Métodos @JavascriptInterface rodam numa thread do WebView, não na principal.
 */
class Bridge(private val act: MainActivity, private val web: WebView) {

    private val ears = Ears(act) { ev -> act.emit("protogenEars", ev) }

    // ---------- ouvidos ----------
    @JavascriptInterface
    fun startListening(lang: String) = act.runOnUiThread { ears.start(lang) }

    @JavascriptInterface
    fun stopListening() = act.runOnUiThread { ears.stop() }

    // ---------- cérebro (llama.cpp entra na próxima etapa) ----------
    @JavascriptInterface
    fun hasBrain(): Boolean = false

    @JavascriptInterface
    fun ask(id: Int, messagesJson: String) {
        act.emit("protogenBrain", JSONObject().put("id", id).put("type", "error").put("text", "sem modelo local"))
    }

    @JavascriptInterface
    fun cancel(id: Int) {}

    @JavascriptInterface
    fun modelName(): String = "nenhum"

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
