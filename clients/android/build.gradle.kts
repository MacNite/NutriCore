/*
 * Versions live here rather than in a version catalogue. There is one module and
 * a handful of dependencies; an extra file of aliases would be indirection
 * without a reader to serve.
 */
plugins {
    id("com.android.application") version "8.7.3" apply false
    id("org.jetbrains.kotlin.android") version "2.0.21" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.0.21" apply false
}
