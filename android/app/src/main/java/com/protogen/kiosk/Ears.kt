package com.protogen.kiosk

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import org.json.JSONObject

/** Reconhecimento de voz nativo; eventos vão para window.protogenEars no JS. Só na thread principal. */
class Ears(private val act: Activity, private val emit: (JSONObject) -> Unit) : RecognitionListener {

    private var sr: SpeechRecognizer? = null
    private var active = false

    fun start(lang: String) {
        if (act.checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            act.requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 1)
            fail("sem permissão de microfone")
            return
        }
        if (!SpeechRecognizer.isRecognitionAvailable(act)) {
            fail("reconhecimento de voz indisponível")
            return
        }
        if (sr == null) {
            sr = SpeechRecognizer.createSpeechRecognizer(act).also { it.setRecognitionListener(this) }
        }
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            .putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang)
            .putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            .putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
        active = true
        sr?.startListening(intent)
    }

    fun stop() {
        sr?.stopListening()
    }

    fun destroy() {
        sr?.destroy()
        sr = null
    }

    private fun send(type: String, text: String? = null, level: Double? = null) {
        val o = JSONObject().put("type", type)
        if (text != null) o.put("text", text)
        if (level != null) o.put("level", level)
        emit(o)
    }

    private fun fail(msg: String) {
        send("error", msg)
        send("end")
    }

    private fun end() {
        if (!active) return
        active = false
        send("end")
    }

    override fun onRmsChanged(rmsdB: Float) {
        // rmsdB vai de ~-2 a ~10
        send("level", level = ((rmsdB + 2f) / 12f).coerceIn(0f, 1f).toDouble())
    }

    override fun onPartialResults(partialResults: Bundle?) {
        val t = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
        if (!t.isNullOrBlank()) send("partial", t)
    }

    override fun onResults(results: Bundle?) {
        val t = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull()
        if (!t.isNullOrBlank()) send("final", t)
        end()
    }

    override fun onError(error: Int) {
        val name = when (error) {
            SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "no-speech"
            SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "sem rede"
            SpeechRecognizer.ERROR_AUDIO -> "erro de áudio"
            SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "sem permissão de microfone"
            SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "reconhecedor ocupado"
            SpeechRecognizer.ERROR_CLIENT -> "aborted"
            else -> "erro $error"
        }
        send("error", name)
        end()
    }

    override fun onReadyForSpeech(params: Bundle?) {}
    override fun onBeginningOfSpeech() {}
    override fun onBufferReceived(buffer: ByteArray?) {}
    override fun onEndOfSpeech() {}
    override fun onEvent(eventType: Int, params: Bundle?) {}
}
