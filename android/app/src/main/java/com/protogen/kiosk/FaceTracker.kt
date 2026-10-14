package com.protogen.kiosk

import android.Manifest
import android.content.pm.PackageManager
import android.util.Log
import android.util.Size
import androidx.activity.ComponentActivity
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.core.ImageProxy
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.face.FaceDetection
import com.google.mlkit.vision.face.FaceDetectorOptions
import java.util.concurrent.Executors

/**
 * Segue o rosto com a câmera frontal, só para os olhos olharem para a pessoa.
 * Tudo no aparelho (ML Kit offline); nenhuma imagem é salva nem enviada.
 * Envia ~10x por segundo: x,y em -1..1 (posição do rosto na tela) e size (0..1).
 */
class FaceTracker(
    private val act: ComponentActivity,
    private val onFace: (x: Double, y: Double, size: Double) -> Unit,
    private val onLost: () -> Unit,
) {
    private val executor = Executors.newSingleThreadExecutor()
    private val detector = FaceDetection.getClient(
        FaceDetectorOptions.Builder()
            .setPerformanceMode(FaceDetectorOptions.PERFORMANCE_MODE_FAST)
            .setMinFaceSize(0.08f)
            .build()
    )
    private var provider: ProcessCameraProvider? = null
    private var lastRun = 0L
    private var detectRot: Int? = null
    private var misses = 0
    private var seen = false
    var running = false
        private set

    fun start() {
        if (running) return
        if (act.checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) return
        running = true
        val future = ProcessCameraProvider.getInstance(act)
        future.addListener({
            runCatching {
                val p = future.get()
                provider = p
                val analysis = ImageAnalysis.Builder()
                    .setResolutionSelector(
                        ResolutionSelector.Builder()
                            .setResolutionStrategy(ResolutionStrategy(Size(640, 480), ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER))
                            .build()
                    )
                    .setBackpressureStrategy(ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                    .setTargetRotation(act.display?.rotation ?: 0)
                    .build()
                analysis.setAnalyzer(executor, ::analyze)
                p.unbindAll()
                p.bindToLifecycle(act, CameraSelector.DEFAULT_FRONT_CAMERA, analysis)
            }.onFailure {
                Log.e(TAG, "câmera indisponível", it)
                running = false
            }
        }, act.mainExecutor)
    }

    fun stop() {
        running = false
        provider?.unbindAll()
        if (seen) { seen = false; onLost() }
    }

    @androidx.annotation.OptIn(androidx.camera.core.ExperimentalGetImage::class)
    private fun analyze(proxy: ImageProxy) {
        val now = System.currentTimeMillis()
        val media = proxy.image
        if (media == null || now - lastRun < 100) { proxy.close(); return }
        lastRun = now
        // Rotação que deixa a imagem alinhada com a TELA (o Android calcula pela orientação da tela)
        val screenRot = proxy.imageInfo.rotationDegrees
        // Rotação que deixa o ROSTO em pé. Pode ser diferente: com a rotação automática desligada,
        // o celular deitado continua com a tela em retrato. Testamos as 4 até achar um rosto.
        val tryRot = detectRot ?: screenRot
        detector.process(InputImage.fromMediaImage(media, tryRot))
            .addOnSuccessListener { faces ->
                val f = faces.maxByOrNull { it.boundingBox.width() * it.boundingBox.height() }
                if (f == null) {
                    misses++
                    if (misses >= 4) {
                        // sem rosto há um tempo: tenta a próxima rotação
                        misses = 0
                        detectRot = (tryRot + 90) % 360
                    }
                    if (seen && misses == 0) { seen = false; onLost() }
                    return@addOnSuccessListener
                }
                misses = 0
                if (detectRot != tryRot) Log.i(TAG, "rosto encontrado com rotação $tryRot (tela: $screenRot)")
                detectRot = tryRot
                seen = true

                // centro do rosto no quadro girado por tryRot, normalizado 0..1
                val (dw, dh) = rotatedSize(proxy.width, proxy.height, tryRot)
                val b = f.boundingBox
                val (u, v) = rotate(b.exactCenterX() / dw, b.exactCenterY() / dh, (360 - tryRot) % 360) // volta ao sensor
                val (sx, sy) = rotate(u, v, screenRot) // e leva para a orientação da tela
                // A câmera frontal não espelha a imagem de análise: lado esquerdo da imagem = lado esquerdo da tela.
                onFace(sx * 2.0 - 1, sy * 2.0 - 1, (b.width().toDouble() / dw).coerceIn(0.0, 1.0))
            }
            .addOnCompleteListener { proxy.close() }
    }

    private fun rotatedSize(w: Int, h: Int, rot: Int) =
        if (rot == 90 || rot == 270) h.toFloat() to w.toFloat() else w.toFloat() to h.toFloat()

    /** Gira um ponto normalizado (u,v) em `rot` graus no sentido horário. */
    private fun rotate(u: Float, v: Float, rot: Int): Pair<Float, Float> = when (rot) {
        90 -> (1 - v) to u
        180 -> (1 - u) to (1 - v)
        270 -> v to (1 - u)
        else -> u to v
    }

    fun destroy() {
        stop()
        detector.close()
        executor.shutdown()
    }

    companion object { private const val TAG = "FaceTracker" }
}
