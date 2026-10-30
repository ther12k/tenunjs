package id.my.tenun.embedder

/**
 * TN-185 (ADR-0026 stage 3): the framework-owned Skia rasterizer
 * (engine/render/skia-host, built as libtenun_skia_host.so by
 * tools/skia-host/build-android.sh) — the EVIDENCE path for on-device
 * parity/performance measurement against the platform Canvas painter.
 *
 * The native methods live in the existing libtenun_android bridge, which
 * dlopen()s the Rust cdylib; when the library is not packaged (JVM-only
 * builds, quick local loops) [available] is false and every render
 * returns null. The production paint surface stays the platform Canvas
 * until measured parity per ADR-0019/0026 switches it.
 */
object SkiaHostBridge {
    private var loaded = false

    private fun ensureLoaded() {
        if (!loaded) {
            System.loadLibrary("tenun_android")
            loaded = true
        }
    }

    /** True when the skia-host cdylib is packaged and its C ABI resolved. */
    val available: Boolean
        get() {
            ensureLoaded()
            return nativeAvailable()
        }

    /**
     * Supplies the typeface pair text ops paint with. Android has no
     * fontconfig default inside the app process, so callers inject the
     * system fonts (e.g. /system/fonts/Roboto-*.ttf) before rendering.
     * Returns the C ABI status (0 ok; -2/-3 invalid font bytes) or -100
     * when the library is absent.
     */
    fun setTypefaces(regular: ByteArray, bold: ByteArray): Int {
        ensureLoaded()
        return nativeSetTypefaces(regular, bold)
    }

    /**
     * Renders a display-list scene JSON into `width x height` RGBA8888
     * bytes, or null when the library is absent or the render failed
     * (the C ABI fails closed — no partial frames).
     */
    fun renderScene(sceneJson: String, width: Int, height: Int): ByteArray? {
        ensureLoaded()
        val out = ByteArray(width * height * 4)
        val rc = nativeRenderScene(sceneJson, width, height, out)
        return if (rc == 0) out else null
    }

    private external fun nativeAvailable(): Boolean
    private external fun nativeSetTypefaces(regular: ByteArray, bold: ByteArray): Int
    private external fun nativeRenderScene(
        sceneJson: String,
        width: Int,
        height: Int,
        out: ByteArray,
    ): Int
}
