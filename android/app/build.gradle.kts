plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// "1.2.3" -> 10203. Mesmo cálculo usado pelo Updater para comparar com a release.
val appVersion = (findProperty("protogen.version") as String?) ?: "0.1.0"
val appVersionCode = appVersion.split(".").map { it.toInt() }.let { (a, b, c) -> a * 10000 + b * 100 + c }

// Chave de assinatura e PIN do quiosque ficam FORA do repositório, em ~/.gradle/gradle.properties
val storeFilePath = findProperty("protogen.storeFile") as String?
val kioskPin = (findProperty("protogen.kioskPin") as String?) ?: "1982"

android {
    namespace = "com.protogen.kiosk"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.protogen.kiosk"
        minSdk = 29
        targetSdk = 35
        versionCode = appVersionCode
        versionName = appVersion
        buildConfigField("String", "UPDATE_REPO", "\"${findProperty("protogen.updateRepo") ?: ""}\"")
        buildConfigField("String", "KIOSK_PIN", "\"$kioskPin\"")
        // Celular (arm64) e emulador (x86_64); evita carregar libs nativas de outras arquiteturas
        ndk { abiFilters += listOf("arm64-v8a", "x86_64") }
    }

    signingConfigs {
        if (storeFilePath != null) {
            create("protogen") {
                storeFile = file(storeFilePath)
                storePassword = findProperty("protogen.storePassword") as String
                keyAlias = findProperty("protogen.keyAlias") as String
                keyPassword = findProperty("protogen.keyPassword") as String
            }
        }
    }

    buildTypes {
        // Debug e release assinados com a mesma chave: o celular aceita
        // atualizar de um para o outro sem desinstalar.
        val key = signingConfigs.findByName("protogen")
        getByName("debug") { if (key != null) signingConfig = key }
        getByName("release") {
            isMinifyEnabled = false
            signingConfig = key ?: signingConfigs.getByName("debug")
        }
    }

    buildFeatures { buildConfig = true }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }

    sourceSets["main"].assets.srcDir(layout.buildDirectory.dir("generated/webassets"))
}

// Copia a interface (../../web) para dentro do APK em assets/web
val copyWeb by tasks.registering(Sync::class) {
    from(rootProject.file("../web"))
    into(layout.buildDirectory.dir("generated/webassets/web"))
}
tasks.named("preBuild") { dependsOn(copyWeb) }

dependencies {
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("androidx.activity:activity-ktx:1.9.3")
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")

    // Palavra de ativação offline
    implementation("com.alphacephei:vosk-android:0.3.47@aar")
    implementation("net.java.dev.jna:jna:5.13.0@aar")

    // Câmera frontal + detecção de rosto no aparelho
    implementation("androidx.camera:camera-camera2:1.4.1")
    implementation("androidx.camera:camera-lifecycle:1.4.1")
    implementation("com.google.mlkit:face-detection:16.1.7")
}
