plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "app.nutricore.sync"
    compileSdk = 35

    defaultConfig {
        applicationId = "app.nutricore.sync"
        /* The Health Connect SDK needs API 26; the Health Connect app itself
           needs Android 9, and is part of the system from Android 14 on. */
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        compose = true
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation(platform("androidx.compose:compose-bom:2024.10.01"))
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.health.connect:connect-client:1.1.0")
    implementation("androidx.work:work-runtime-ktx:2.9.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.8.1")

    /* No HTTP or JSON library. `HttpURLConnection` and `org.json` are on every
       Android since forever, the payload is six fields wide, and a dependency
       that has to be kept current is a cost this app cannot pay: it is built
       once by somebody who wanted their weight synced, not maintained. */

    testImplementation("junit:junit:4.13.2")
}
