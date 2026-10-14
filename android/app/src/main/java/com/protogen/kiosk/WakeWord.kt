package com.protogen.kiosk

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.os.Handler
import android.os.Looper
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import org.vosk.Model
import org.vosk.Recognizer
import org.vosk.android.RecognitionListener
import org.vosk.android.SpeechService
import java.io.File
import kotlin.concurrent.thread

/**
 * Escuta contínua e offline da palavra de ativação ("ei proto" / "hey proto") com Vosk.
 * Usa gramática fechada: o reconhecedor só tenta encaixar estas frases (ou [unk]),
 * o que é leve e evita falso positivo. "hey" não existe no vocabulário PT; soa como "rei".
 * Só na thread principal.
 */
class WakeWord(
    private val ctx: Context,
    private val onWake: () -> Unit,
    private val onDebug: (String) -> Unit,
) : RecognitionListener {

    private val main = Handler(Looper.getMainLooper())
    private var model: Model? = null
    private var service: SpeechService? = null
    private var wanted = false
    var loaded = false
        private set
    var debug = false
    /** Confiança mínima da palavra "proto" (0..1). */
    var threshold = 0.5

    fun load(dir: File) {
        if (loaded) return
        thread(name = "vosk-load") {
            val m = runCatching { Model(dir.absolutePath) }
                .onFailure { Log.e(TAG, "falha ao carregar modelo", it) }
                .getOrNull()
            main.post {
                model = m
                loaded = m != null
                if (wanted) startInternal()
            }
        }
    }

    fun setEnabled(on: Boolean) {
        wanted = on
        if (on) startInternal() else stopInternal()
    }

    private fun startInternal() {
        val m = model ?: return
        if (service != null) return
        if (ctx.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) return
        runCatching {
            val rec = Recognizer(m, SAMPLE_RATE, GRAMMAR).apply { setWords(true) }
            service = SpeechService(rec, SAMPLE_RATE).also { it.startListening(this) }
        }.onFailure { Log.e(TAG, "falha ao iniciar escuta", it) }
    }

    private fun stopInternal() {
        service?.let {
            it.stop()
            it.shutdown() // libera o microfone para o reconhecedor do Android
        }
        service = null
    }

    fun destroy() {
        stopInternal()
        model?.close()
        model = null
    }

    override fun onResult(hypothesis: String) {
        val j = JSONObject(hypothesis)
        val words = j.optJSONArray("result") ?: JSONArray()
        var best = 0.0
        for (i in 0 until words.length()) {
            val w = words.getJSONObject(i)
            if (w.optString("word") == "proto") best = maxOf(best, w.optDouble("conf"))
        }
        val text = j.optString("text")
        if (debug && text.isNotBlank()) onDebug("ouvi: \"$text\" (proto %.2f)".format(best))
        if (best >= threshold) {
            setEnabled(false)
            onWake()
        }
    }

    override fun onPartialResult(hypothesis: String) {}
    override fun onFinalResult(hypothesis: String) {}
    override fun onError(exception: Exception) { Log.e(TAG, "erro", exception); stopInternal(); if (wanted) main.postDelayed({ if (wanted) startInternal() }, 2000) }
    override fun onTimeout() {}

    companion object {
        private const val TAG = "WakeWord"
        private const val SAMPLE_RATE = 16000f
        private val GRAMMAR = JSONArray(listOf("ei proto", "rei proto", "e proto", "oi proto", "proto", "[unk]")).toString()
    }
}
