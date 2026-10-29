// SPDX-License-Identifier: AGPL-3.0-only
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "org.nonverba.participant"
    buildFeatures { buildConfig = true }
    compileSdk = 36

    defaultConfig {
        applicationId = "org.nonverba.participant"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.7.0"
        buildConfigField("boolean", "KEEP_SCREEN_AWAKE", providers.gradleProperty("nonverba.keepScreenAwake")
            .orElse("false").get().toBooleanStrict().toString())
    }

    sourceSets.getByName("main").assets.srcDir(layout.buildDirectory.dir("generated/participant-capture-assets-v1"))
    sourceSets.getByName("main").java.srcDir("../shared/src/main/kotlin")

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            // Distribution signing is supplied separately after its policy is agreed.
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

val verifyParticipantAssets by tasks.registering {
    val assets = layout.buildDirectory.dir("generated/participant-capture-assets-v1")
    inputs.dir(assets)
    doLast {
        val required = setOf(
            "participant/index.html", "participant/participant.css",
            "participant/participant.js", "participant/branding/sprout.svg",
            "participant/branding/home-sprout.webp", "participant/branding/home-succulent.webp",
            "participant/branding/waajacu.webp",
            "participant/identity/level-1.webp", "participant/identity/level-2.webp",
            "participant/identity/unverified.webp",
            "participant/onboarding-ui.js", "participant/onboarding-account.js", "participant/account-transport.js",
            "participant/account-terms.js",
            "participant/identity-intake-notice.js",
            "participant/identity-state.js", "participant/password-manager-sign-in.js",
            "participant/identity-review-client.js", "participant/identity-review-ui.js",
            "participant/recovery-export.js",
            "participant/identity/enrollment-camera.js", "participant/identity/identity-capture.js",
            "participant/identity/identity-camera-tool.js", "participant/identity/identity-capture-proof.js",
            "participant/identity/device-attestation.js",
            "participant/identity/browser-attestation-keys.js"
        )
        val root = assets.get().asFile
        check(required.all { root.resolve(it).isFile }) {
            "Missing participant assets. Stage the reviewed participant shell in this managed Linux build tree before building :participant."
        }
        val actual = root.walkTopDown().filter { it.isFile }
            .map { it.relativeTo(root).invariantSeparatorsPath }.toSet()
        check(actual.filterNot { it.startsWith("nonverba-license/") }.toSet() == required) {
            "Participant assets differ from the reviewed account, capture and attestation files; developer tools and generated models must remain outside this APK."
        }
        check(required.sumOf { root.resolve(it).length() } <= 499 * 1024) {
            "Participant runtime exceeds the reviewed 499 KiB account and synthetic review budget."
        }
        check(required.filter { it.endsWith(".svg") || it.endsWith(".webp") }
            .all { root.resolve(it).length() <= 8 * 1024 }) {
            "Participant images exceed their unchanged 8 KiB individual budget."
        }
        check(setOf("nonverba-license/LICENSE.txt", "nonverba-license/SOURCE.txt").all { it in actual }) {
            "Participant license/source notices are missing. Stage the current corresponding-source notices before building :participant."
        }
    }
}

tasks.named("preBuild").configure { dependsOn(verifyParticipantAssets) }
