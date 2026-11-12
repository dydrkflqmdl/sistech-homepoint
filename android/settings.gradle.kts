// HOME POINT NAVI 안드로이드 앱(WebView). 사이트(https://sistech.dpdns.org)를 앱 안에서 띄운다.
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

rootProject.name = "HomePointNavi"
include(":app")
