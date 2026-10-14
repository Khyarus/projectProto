package com.protogen.kiosk

import android.text.Html
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLDecoder
import java.net.URLEncoder

/**
 * Ferramentas de internet do agente. Todas gratuitas e sem chave de API:
 * - busca: DuckDuckGo (versão HTML)
 * - clima e localização de cidades: Open-Meteo
 * - notícias: RSS do Google Notícias
 * Rodam no Kotlin porque o WebView bloquearia essas chamadas (CORS).
 * Respostas curtas de propósito: o modelo no celular processa ~9 tokens/s.
 */
object Tools {

    private const val UA = "Mozilla/5.0 (Linux; Android 16) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140 Mobile Safari/537.36"

    private fun get(url: String): String {
        val conn = URL(url).openConnection() as HttpURLConnection
        conn.setRequestProperty("User-Agent", UA)
        conn.setRequestProperty("Accept-Language", "pt-BR,pt;q=0.9")
        conn.connectTimeout = 8_000
        conn.readTimeout = 10_000
        try {
            if (conn.responseCode != 200) throw IllegalStateException("HTTP ${conn.responseCode}")
            return conn.inputStream.bufferedReader().readText()
        } finally {
            conn.disconnect()
        }
    }

    private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")
    private fun text(html: String) = Html.fromHtml(html, Html.FROM_HTML_MODE_LEGACY).toString().replace(Regex("\\s+"), " ").trim()

    fun run(name: String, arg: String): String = when (name) {
        "search" -> search(arg)
        "weather" -> weather(arg)
        "news" -> news(arg)
        else -> throw IllegalArgumentException("ferramenta desconhecida: $name")
    }

    // ---------- busca ----------
    fun search(query: String): String {
        val html = get("https://html.duckduckgo.com/html/?q=${enc(query)}&kl=br-pt")
        val titles = Regex("""class="result__a"[^>]*>(.*?)</a>""", RegexOption.DOT_MATCHES_ALL).findAll(html).map { text(it.groupValues[1]) }.toList()
        val snippets = Regex("""class="result__snippet"[^>]*href="[^"]*?uddg=([^&"]+)[^>]*>(.*?)</a>""", RegexOption.DOT_MATCHES_ALL)
            .findAll(html).map { m ->
                val host = runCatching { URL(URLDecoder.decode(m.groupValues[1], "UTF-8")).host.removePrefix("www.") }.getOrDefault("")
                host to text(m.groupValues[2])
            }.toList()
        if (snippets.isEmpty()) return "A busca por \"$query\" não trouxe resultados."
        return snippets.take(3).mapIndexed { i, (host, s) ->
            "${titles.getOrElse(i) { host }} ($host): ${s.take(220)}"
        }.joinToString("\n")
    }

    // ---------- clima ----------
    private val geoCache = mutableMapOf<String, Triple<Double, Double, String>>()

    private fun geocode(city: String): Triple<Double, Double, String> = geoCache.getOrPut(city.lowercase()) {
        val j = JSONObject(get("https://geocoding-api.open-meteo.com/v1/search?name=${enc(city)}&count=1&language=pt"))
        val r = j.optJSONArray("results")?.optJSONObject(0) ?: throw IllegalStateException("cidade não encontrada: $city")
        val label = listOfNotNull(r.optString("name"), r.optString("admin1").ifBlank { null }).joinToString(", ")
        Triple(r.getDouble("latitude"), r.getDouble("longitude"), label)
    }

    private fun wmo(code: Int) = when (code) {
        0 -> "céu limpo"; 1 -> "quase limpo"; 2 -> "parcialmente nublado"; 3 -> "nublado"
        45, 48 -> "neblina"
        51, 53, 55, 56, 57 -> "garoa"
        61, 63, 66 -> "chuva"; 65, 67 -> "chuva forte"
        71, 73, 75, 77 -> "neve"
        80, 81 -> "pancadas de chuva"; 82 -> "pancadas fortes de chuva"
        95, 96, 99 -> "tempestade"
        else -> "tempo variável"
    }

    fun weather(city: String): String {
        if (city.isBlank()) return "Não sei a cidade do usuário. Peça para ele configurar com o comando /local."
        val (lat, lon, label) = geocode(city)
        val j = JSONObject(get(
            "https://api.open-meteo.com/v1/forecast?latitude=$lat&longitude=$lon" +
                "&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m" +
                "&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weather_code" +
                "&timezone=auto&forecast_days=2"
        ))
        val c = j.getJSONObject("current")
        val d = j.getJSONObject("daily")
        fun day(i: Int) = "${wmo(d.getJSONArray("weather_code").getInt(i))}, " +
            "mínima ${d.getJSONArray("temperature_2m_min").getDouble(i).toInt()} e máxima ${d.getJSONArray("temperature_2m_max").getDouble(i).toInt()} graus, " +
            "${d.getJSONArray("precipitation_probability_max").optInt(i)}% de chance de chuva"
        return "Clima em $label agora: ${c.getDouble("temperature_2m").toInt()} graus " +
            "(sensação de ${c.getDouble("apparent_temperature").toInt()}), ${wmo(c.getInt("weather_code"))}, " +
            "umidade ${c.getInt("relative_humidity_2m")}%, vento ${c.getDouble("wind_speed_10m").toInt()} km/h.\n" +
            "Hoje: ${day(0)}.\nAmanhã: ${day(1)}."
    }

    // ---------- notícias ----------
    fun news(topic: String): String {
        val url = if (topic.isBlank()) "https://news.google.com/rss?hl=pt-BR&gl=BR&ceid=BR:pt-419"
        else "https://news.google.com/rss/search?q=${enc(topic)}&hl=pt-BR&gl=BR&ceid=BR:pt-419"
        val xml = get(url)
        val titles = Regex("<item>.*?<title>(.*?)</title>", RegexOption.DOT_MATCHES_ALL).findAll(xml)
            .map { text(it.groupValues[1].removePrefix("<![CDATA[").removeSuffix("]]>")) }
            .take(5).toList()
        if (titles.isEmpty()) return "Nenhuma notícia encontrada."
        return "Manchetes" + (if (topic.isBlank()) "" else " sobre $topic") + ":\n" + titles.joinToString("\n") { "- $it" }
    }
}
