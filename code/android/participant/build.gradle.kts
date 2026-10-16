// SPDX-License-Identifier: AGPL-3.0-only
plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "org.nonverba.participant"
    compileSdk = 36

    defaultConfig {
        applicationId = "org.nonverba.participant"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "0.7.0"
    }

    sourceSets.getByName("main").assets.srcDir(layout.buildDirectory.dir("generated/participant-assets"))

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
    val assets = layout.buildDirectory.dir("generated/participant-assets")
    inputs.dir(assets)
    doLast {
        val required = setOf(
            "participant/index.html", "participant/participant.css",
            "participant/participant.js", "participant/branding/sprout.svg"
        )
        val root = assets.get().asFile
        check(required.all { root.resolve(it).isFile }) {
            "Missing participant assets. Stage the reviewed participant shell in this managed Linux build tree before building :participant."
        }
        val actual = root.walkTopDown().filter { it.isFile }
            .map { it.relativeTo(root).invariantSeparatorsPath }.toSet()
        check(actual.filterNot { it.startsWith("nonverba-license/") }.toSet() == required) {
            "Participant assets differ from the four reviewed shell files; developer tools and generated models must remain outside this APK."
        }
        check(setOf("nonverba-license/LICENSE.txt", "nonverba-license/SOURCE.txt").all { it in actual }) {
            "Participant license/source notices are missing. Stage the current corresponding-source notices before building :participant."
        }
    }
}

tasks.named("preBuild").configure { dependsOn(verifyParticipantAssets) }
