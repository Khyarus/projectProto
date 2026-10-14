package com.protogen.kiosk

import android.util.Log
import org.json.JSONArray
import java.io.File
import java.util.concurrent.Executors

/**
 * Cérebro local: llama.cpp embutido (libprotollm.so).
 * Tudo roda numa thread própria; um pedido por vez.
 */
object Llm {
    private const val TAG = "Llm"

    fun interface TokenSink { fun onToken(text: String) }

    private external fun nativeInit()
    private external fun nativeLoad(path: String, nCtx: Int, nThreads: Int): String?
    private external fun nativeGenerate(
        roles: Array<String>, contents: Array<String>, maxTokens: Int, temp: Float, sink: TokenSink,
    ): String?
    private external fun nativeCancel()
    private external fun nativeUnload()

    private val worker = Executors.newSingleThreadExecutor { Thread(it, "llm").apply { priority = Thread.MAX_PRIORITY } }
    private var initialized = false

    @Volatile var loadedPath: String? = null
        private set
    @Volatile var loading = false
        private set

    /** Carrega o modelo em segundo plano. done(erro ou null). */
    fun load(file: File, done: (String?) -> Unit) {
        if (loadedPath == file.absolutePath) return done(null)
        loading = true
        worker.execute {
            if (!initialized) {
                System.loadLibrary("protollm")
                nativeInit()
                initialized = true
            }
            // Big.LITTLE do A34: 4 threads rende mais que 8 (os núcleos pequenos atrasam os grandes)
            val threads = Runtime.getRuntime().availableProcessors().coerceIn(2, 4)
            val err = nativeLoad(file.absolutePath, 4096, threads)
            loadedPath = if (err == null) file.absolutePath else null
            loading = false
            Log.i(TAG, "load ${file.name}: ${err ?: "ok"}")
            done(err)
        }
    }

    /**
     * Gera resposta para o histórico [{role, content}...] (JSON). Tokens chegam em onToken;
     * no fim chama done(erro ou null). Pedido novo enquanto outro roda entra na fila.
     */
    fun generate(messagesJson: String, onToken: (String) -> Unit, done: (String?) -> Unit) {
        worker.execute {
            if (loadedPath == null) return@execute done("modelo não carregado")
            val arr = JSONArray(messagesJson)
            val roles = Array(arr.length()) { arr.getJSONObject(it).getString("role") }
            val contents = Array(arr.length()) { arr.getJSONObject(it).getString("content") }
            val err = runCatching { nativeGenerate(roles, contents, 256, 0.7f) { onToken(it) } }
                .getOrElse { it.message ?: "erro" }
            done(err)
        }
    }

    /** Interrompe a geração atual (o resto da fila continua). */
    fun cancel() { if (initialized) nativeCancel() }

    fun unload() {
        worker.execute { if (initialized) nativeUnload(); loadedPath = null }
    }
}
