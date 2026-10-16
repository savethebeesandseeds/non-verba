// SPDX-License-Identifier: AGPL-3.0-only
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "NonVerba"
when (val target = providers.gradleProperty("nonverba.target").orElse("all").get()) {
    "developer" -> include(":app")
    "participant" -> include(":participant")
    "all" -> include(":app", ":participant")
    else -> error("Unknown nonverba.target: $target; use developer, participant or all.")
}
