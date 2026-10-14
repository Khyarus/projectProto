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
                            .setResolutionStrategy(ResolutionStrategy(Size(480, 360), ResolutionStrategy.FALLBACK_RULE_CLOSEST_LOWER_THEN_HIGHER))
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
        val rot = proxy.imageInfo.rotationDegrees
        // Depois de girar, a imagem fica "em pé" como a tela
        val w = if (rot == 90 || rot == 270) proxy.height else proxy.width
        val h = if (rot == 90 || rot == 270) proxy.width else proxy.height
        detector.process(InputImage.fromMediaImage(media, rot))
            .addOnSuccessListener { faces ->
                val f = faces.maxByOrNull { it.boundingBox.width() * it.boundingBox.height() }
                if (f == null) {
                    if (seen) { seen = false; onLost() }
                } else {
                    seen = true
                    val b = f.boundingBox
                    // A câmera frontal não espelha a imagem de análise: o lado esquerdo da imagem
                    // é o lado esquerdo da tela. x/y em -1..1.
                    val x = (b.exactCenterX() / w) * 2 - 1
                    val y = (b.exactCenterY() / h) * 2 - 1
                    onFace(x.toDouble(), y.toDouble(), (b.width().toDouble() / w).coerceIn(0.0, 1.0))
                }
            }
            .addOnCompleteListener { proxy.close() }
    }

    fun destroy() {
        stop()
        detector.close()
        executor.shutdown()
    }

    companion object { private const val TAG = "FaceTracker" }
}
