plugins {
    id("org.jetbrains.kotlin.jvm")
}

// TN-177: offline BLE write-path regression module. A PLAIN JVM module on
// purpose — no android.jar on the classpath, so the hand-written android.*
// platform fakes in src/main/kotlin cannot collide with SDK stubs. The two
// PRODUCTION write-path sources are attached to compilation by explicit
// include filter (srcDir entries must be directories on this Gradle
// version); every other :app source needs the real Android APIs and stays
// out.

dependencies {
    // Matches :app's testImplementation — the production service uses
    // org.json for its event payloads.
    implementation("org.json:json:20240303")
    testImplementation("junit:junit:4.13.2")
}

tasks.named<org.jetbrains.kotlin.gradle.tasks.KotlinCompile>("compileKotlin") {
    source(fileTree("../app/src/main/kotlin") {
        include("**/PolytronBleService.kt")
        include("**/GattWriteLedger.kt")
        include("**/HostServiceRegistry.kt")
        include("**/TenunEngine.kt")
    })
}
