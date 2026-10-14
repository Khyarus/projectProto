package com.protogen.kiosk

import android.content.Context
import android.net.ConnectivityManager
import android.net.NetworkCapabilities
import android.util.Log
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.util.zip.ZipInputStream

/**
 * Catálogo e download de modelos (LLM e palavra de ativação).
 *
 * O catálogo é o web/models.json: primeiro tenta a versão do GitHub (para trocar o modelo
 * sem lançar APK novo), senão usa a que veio dentro do app.
 * Os arquivos ficam em /sdcard/Android/data/com.protogen.kiosk/files/models, então também
 * dá para copiar um modelo do PC com: adb push modelo.gguf <essa pasta>
 */
class ModelManager(private val ctx: Context) {

    data class Model(
        val id: String, val kind: String, val name: String, val url: String,
        val size: Long, val file: String, val unzip: String?, val notes: String,
    )

    private val prefs = ctx.getSharedPreferences("models", Context.MODE_PRIVATE)
    val dir: File = File(ctx.getExternalFilesDir(null), "models").apply { mkdirs() }

    var catalog: JSONObject = loadBundled()
        private set
    val models: List<Model> get() = parse(catalog)

    /** Downloads em andamento, por id. */
    val jobs = mutableMapOf<String, Job>()

    private fun loadBundled() = JSONObject(ctx.assets.open("web/models.json").bufferedReader().readText())

    suspend fun refreshCatalog() = withContext(Dispatchers.IO) {
        val repo = BuildConfig.UPDATE_REPO
        if (repo.isBlank()) return@withContext
        runCatching {
            val conn = URL("https://raw.githubusercontent.com/$repo/main/web/models.json").openConnection() as HttpURLConnection
            conn.connectTimeout = 10_000
            conn.readTimeout = 10_000
            try {
                if (conn.responseCode == 200) {
                    val j = JSONObject(conn.inputStream.bufferedReader().readText())
                    if (j.optInt("version") >= catalog.optInt("version")) catalog = j
                }
            } finally {
                conn.disconnect()
            }
        }.onFailure { Log.w(TAG, "catálogo remoto indisponível: ${it.message}") }
    }

    private fun parse(j: JSONObject): List<Model> {
        val arr = j.getJSONArray("models")
        return (0 until arr.length()).map { i ->
            val m = arr.getJSONObject(i)
            Model(
                m.getString("id"), m.getString("kind"), m.getString("name"), m.getString("url"),
                m.optLong("size"), m.getString("file"), m.optString("unzip").ifBlank { null }, m.optString("notes"),
            )
        }
    }

    fun get(id: String) = models.find { it.id == id }

    /** Caminho pronto para uso: o .gguf, ou a pasta descompactada. */
    fun path(m: Model): File = if (m.unzip != null) File(dir, m.unzip) else File(dir, m.file)

    fun isInstalled(m: Model): Boolean {
        val p = path(m)
        return if (m.unzip != null) p.isDirectory && (p.list()?.isNotEmpty() == true)
        else p.isFile && (m.size <= 0 || p.length() == m.size)
    }

    // ---------- escolha ----------
    var selectedLlm: String
        get() = prefs.getString("llm", null) ?: catalog.optString("llm_default")
        set(v) { prefs.edit().putString("llm", v).apply() }

    val wakeModel: Model? get() = get(catalog.optString("wake_default"))

    fun installedLlm(): Model? = get(selectedLlm)?.takeIf { it.kind == "llm" && isInstalled(it) }

    fun isUnmetered(): Boolean {
        val cm = ctx.getSystemService(ConnectivityManager::class.java)
        val caps = cm.getNetworkCapabilities(cm.activeNetwork) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
    }

    fun toJson(): String {
        val arr = JSONArray()
        for (m in models) {
            val partial = File(dir, m.file + ".part")
            arr.put(
                JSONObject()
                    .put("id", m.id).put("kind", m.kind).put("name", m.name).put("size", m.size)
                    .put("notes", m.notes).put("installed", isInstalled(m))
                    .put("selected", m.kind == "llm" && m.id == selectedLlm)
                    .put("downloading", jobs[m.id]?.isActive == true)
                    .put("partial", if (partial.exists()) partial.length() else 0)
            )
        }
        return arr.toString()
    }

    // ---------- download ----------
    /** Baixa com retomada (.part + Range). progress(0..100). */
    suspend fun download(m: Model, progress: (Int) -> Unit) = withContext(Dispatchers.IO) {
        val target = File(dir, m.file)
        val part = File(dir, m.file + ".part")
        var done = if (part.exists()) part.length() else 0L

        val conn = URL(m.url).openConnection() as HttpURLConnection
        conn.instanceFollowRedirects = true
        conn.connectTimeout = 20_000
        conn.readTimeout = 60_000
        if (done > 0) conn.setRequestProperty("Range", "bytes=$done-")
        try {
            val code = conn.responseCode
            if (code == 200) done = 0 // servidor ignorou o Range: recomeça
            else if (code != 206) throw IllegalStateException("HTTP $code")
            val total = if (m.size > 0) m.size else done + conn.contentLengthLong
            var lastPct = -1
            conn.inputStream.use { input ->
                java.io.FileOutputStream(part, done > 0).use { out ->
                    val buf = ByteArray(256 * 1024)
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n)
                        done += n
                        val pct = if (total > 0) (done * 100 / total).toInt() else 0
                        if (pct != lastPct) { lastPct = pct; progress(pct) }
                    }
                }
            }
        } finally {
            conn.disconnect()
        }
        if (m.size > 0 && part.length() != m.size) throw IllegalStateException("tamanho errado: ${part.length()} != ${m.size}")
        target.delete()
        part.renameTo(target)

        if (m.unzip != null) {
            unzip(target, dir)
            target.delete()
        }
    }

    private fun unzip(zip: File, into: File) {
        val root = into.canonicalPath + File.separator
        ZipInputStream(zip.inputStream().buffered()).use { zin ->
            while (true) {
                val e = zin.nextEntry ?: break
                val out = File(into, e.name)
                // impede caminhos fora da pasta ("zip slip")
                if (!out.canonicalPath.startsWith(root)) throw SecurityException("entrada inválida no zip: ${e.name}")
                if (e.isDirectory) out.mkdirs()
                else {
                    out.parentFile?.mkdirs()
                    out.outputStream().use { zin.copyTo(it) }
                }
            }
        }
    }

    fun delete(m: Model) {
        path(m).deleteRecursively()
        File(dir, m.file).delete()
        File(dir, m.file + ".part").delete()
    }

    companion object { private const val TAG = "Models" }
}
