plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Test-only init-failure injection: `-Ptenun.testInjection=true` compiles
// the native hook (CMake TENUN_ENABLE_TEST_INJECTION). Used exclusively by
// the device-acceptance fail-visible stage; production and standard debug
// builds never define it.
val tenunTestInjection = providers.gradleProperty("tenun.testInjection").map { it == "true" }.getOrElse(false)

// TN-189: instrument the compiled public TypeScript adapter, not a handwritten
// JS copy or a stale checked-in bundle. This asset belongs only to the test APK.
val keysFixtureAssets = layout.buildDirectory.dir("generated/androidTest/keys-fixture")
val buildKeysFixture by tasks.registering(Exec::class) {
    val repoRoot = rootProject.projectDir.resolve("../..")
    val tools = rootProject.projectDir.resolve("tools/gallery-bundle")
    workingDir(repoRoot)
    commandLine("bun", tools.resolve("build-keys-fixture.ts"), keysFixtureAssets.get().file("keys_fixture.js").asFile)
    inputs.files(tools.resolve("build-keys-fixture.ts"), tools.resolve("keys-fixture-entry.ts"), tools.resolve("tsconfig.json"))
    inputs.dir(repoRoot.resolve("packages/platform/src"))
    outputs.dir(keysFixtureAssets)
}
// TN-188: same discipline for the net adapter fixture (contract + bridge
// compiled from the public package, instrumentation-only asset).
val netFixtureAssets = layout.buildDirectory.dir("generated/androidTest/net-fixture")
val buildNetFixture by tasks.registering(Exec::class) {
    val repoRoot = rootProject.projectDir.resolve("../..")
    val tools = rootProject.projectDir.resolve("tools/gallery-bundle")
    workingDir(repoRoot)
    commandLine("bun", tools.resolve("build-net-fixture.ts"), netFixtureAssets.get().file("net_fixture.js").asFile)
    inputs.files(tools.resolve("build-net-fixture.ts"), tools.resolve("net-fixture-entry.ts"), tools.resolve("tsconfig.json"))
    inputs.dir(repoRoot.resolve("packages/platform/src"))
    outputs.dir(netFixtureAssets)
}
// TN-190: same discipline for the discovery adapter fixture.
val discoveryFixtureAssets = layout.buildDirectory.dir("generated/androidTest/discovery-fixture")
val buildDiscoveryFixture by tasks.registering(Exec::class) {
    val repoRoot = rootProject.projectDir.resolve("../..")
    val tools = rootProject.projectDir.resolve("tools/gallery-bundle")
    workingDir(repoRoot)
    commandLine("bun", tools.resolve("build-discovery-fixture.ts"), discoveryFixtureAssets.get().file("discovery_fixture.js").asFile)
    inputs.files(tools.resolve("build-discovery-fixture.ts"), tools.resolve("discovery-fixture-entry.ts"), tools.resolve("tsconfig.json"))
    inputs.dir(repoRoot.resolve("packages/platform/src"))
    outputs.dir(discoveryFixtureAssets)
}
tasks.configureEach {
    if (name.startsWith("merge") && name.endsWith("AndroidTestAssets")) {
        dependsOn(buildKeysFixture)
        dependsOn(buildNetFixture)
        dependsOn(buildDiscoveryFixture)
    }
}

android {
    namespace = "id.my.tenun.embedder"
    compileSdk = 36
    ndkVersion = "28.2.13676358"

    defaultConfig {
        applicationId = "id.my.tenun.embedder"
        minSdk = 26
        targetSdk = 36
        versionCode = 12
        versionName = "0.2.1"

        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        externalNativeBuild {
            cmake {
                cFlags("-std=c11 -Wall -Wextra -Werror")
                if (tenunTestInjection) {
                    arguments("-DTENUN_ENABLE_TEST_INJECTION=ON")
                }
            }
        }

        ndk {
            abiFilters.addAll(listOf("arm64-v8a", "x86_64"))
        }
    }

    externalNativeBuild {
        cmake {
            path = file("src/main/cpp/CMakeLists.txt")
            version = "3.22.1"
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = "17"
    }

    sourceSets.getByName("androidTest").assets.srcDir(keysFixtureAssets)
    sourceSets.getByName("androidTest").assets.srcDir(netFixtureAssets)
    sourceSets.getByName("androidTest").assets.srcDir(discoveryFixtureAssets)
}

dependencies {
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.json:json:20240303")

    // TN-132 installed-device acceptance (androidTest): exercised only by
    // connectedDebugAndroidTest / am instrument against a booted emulator.
    androidTestImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:core:1.6.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
    androidTestImplementation("androidx.test.uiautomator:uiautomator:2.3.0")
}
