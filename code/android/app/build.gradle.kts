// SPDX-License-Identifier: AGPL-3.0-only
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "org.nonverba.camera"
    buildFeatures { buildConfig = true }
    compileSdk = 36
    ndkPath = System.getenv("ANDROID_NDK_HOME")
        ?: error("Run Android builds through code/dev.ps1 inside non-verba-dev.")
    ndkVersion = "30.0.16248370"

    defaultConfig {
        applicationId = "org.nonverba.camera"
        minSdk = 26
        targetSdk = 36
        versionCode = 9
        versionName = "0.7.0"
        ndk { abiFilters += listOf("arm64-v8a", "x86_64") }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    externalNativeBuild {
        cmake {
            path = file("src/main/cpp/CMakeLists.txt")
            version = "4.3.3"
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // Production signing is intentionally supplied outside the source tree.
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.core:core:1.16.0")
}

val verifyNativeLibraries by tasks.registering {
    val libraries = layout.projectDirectory.dir("src/main/jniLibs")
    inputs.dir(libraries)
    doLast {
        check(listOf("arm64-v8a", "x86_64").all { libraries.file("$it/libnonverba_android.so").asFile.isFile }) {
            "Missing native location core. Run code/dev.ps1 Native before building the APK."
        }
    }
}

val verifyWebAssets by tasks.registering {
    val webAssets = layout.projectDirectory.dir("src/main/assets/web")
    inputs.dir(webAssets)
    doLast {
        val requiredAssets = listOf(
            "index.html", "audio.html", "audio-worklet.js", "audio-capture.js", "audio-peer.js", "audio-demo.js", "audio-platform.js",
            "location.html", "location-platform.js", "location-capture.js", "location-ui.js", "location-policy.js", "location.css", "camera-location.js", "camera-platform.js",
            "live-location.html", "live-location-ui.js", "live-location-session.js", "live-session-storage.js", "live-peer.js",
            "agent-requester.js", "agent-evidence-storage.js",
            "camera-acceptance.js", "audio-session.js",
            "key-enrollment.html", "key-enrollment-ui.js", "key-enrollment-platform.js", "key-enrollment.css"
        )
        check(requiredAssets.all { webAssets.file(it).asFile.isFile }) {
            "Missing shared camera/audio/location app. From code/, run node tools/build-web.mjs and node tools/stage-android.mjs first."
        }
        check(webAssets.asFile.walkTopDown().any { it.isFile && it.extension == "wasm" }) {
            "Missing Rust WebAssembly module. Build the shared web assets before packaging the APK."
        }
    }
}

tasks.named("preBuild").configure { dependsOn(verifyWebAssets, verifyNativeLibraries) }
