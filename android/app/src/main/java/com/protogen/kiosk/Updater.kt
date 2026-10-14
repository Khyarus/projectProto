package com.protogen.kiosk

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageInstaller
import android.os.Build
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * Atualização pelo GitHub Releases.
 * Lê https://api.github.com/repos/<UPDATE_REPO>/releases/latest; se a tag (ex.: v0.2.0) for maior
 * que a versão instalada, baixa o .apk anexado e instala via PackageInstaller.
 * Como dono do aparelho a instalação é silenciosa; senão o Android pede confirmação.
 * O Android só aceita o APK se for assinado com a mesma chave.
 */
object Updater {

    data class Release(val version: String, val apkUrl: String)

    fun versionCodeOf(v: String): Int {
        val p = v.removePrefix("v").split(".").map { it.takeWhile(Char::isDigit).toIntOrNull() ?: 0 }
        return p.getOrElse(0) { 0 } * 10000 + p.getOrElse(1) { 0 } * 100 + p.getOrElse(2) { 0 }
    }

    suspend fun check(): Release? = withContext(Dispatchers.IO) {
        val repo = BuildConfig.UPDATE_REPO
        if (repo.isBlank()) throw IllegalStateException("repositório de atualização não configurado")
        val conn = URL("https://api.github.com/repos/$repo/releases/latest").openConnection() as HttpURLConnection
        conn.setRequestProperty("Accept", "application/vnd.github+json")
        conn.connectTimeout = 15_000
        conn.readTimeout = 15_000
        try {
            if (conn.responseCode == 404) return@withContext null // ainda sem releases (ou repo privado)
            if (conn.responseCode != 200) throw IllegalStateException("GitHub HTTP ${conn.responseCode}")
            val j = JSONObject(conn.inputStream.bufferedReader().readText())
            val tag = j.getString("tag_name")
            if (versionCodeOf(tag) <= BuildConfig.VERSION_CODE) return@withContext null
            val assets = j.getJSONArray("assets")
            for (i in 0 until assets.length()) {
                val a = assets.getJSONObject(i)
                if (a.getString("name").endsWith(".apk")) {
                    return@withContext Release(tag.removePrefix("v"), a.getString("browser_download_url"))
                }
            }
            null
        } finally {
            conn.disconnect()
        }
    }

    suspend fun downloadAndInstall(ctx: Context, rel: Release) {
        val file = File(ctx.cacheDir, "update.apk")
        withContext(Dispatchers.IO) {
            val conn = URL(rel.apkUrl).openConnection() as HttpURLConnection
            conn.instanceFollowRedirects = true
            conn.connectTimeout = 15_000
            conn.readTimeout = 60_000
            try {
                if (conn.responseCode != 200) throw IllegalStateException("download HTTP ${conn.responseCode}")
                conn.inputStream.use { input -> file.outputStream().use { input.copyTo(it) } }
            } finally {
                conn.disconnect()
            }
        }
        withContext(Dispatchers.IO) { install(ctx, file) }
    }

    private fun install(ctx: Context, apk: File) {
        val installer = ctx.packageManager.packageInstaller
        val params = PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL).apply {
            setAppPackageName(ctx.packageName)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED)
            }
        }
        val id = installer.createSession(params)
        installer.openSession(id).use { session ->
            session.openWrite("app.apk", 0, apk.length()).use { out ->
                apk.inputStream().use { it.copyTo(out) }
                session.fsync(out)
            }
            val pi = PendingIntent.getBroadcast(
                ctx, id, Intent(ctx, InstallReceiver::class.java),
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
            )
            session.commit(pi.intentSender)
        }
    }
}
