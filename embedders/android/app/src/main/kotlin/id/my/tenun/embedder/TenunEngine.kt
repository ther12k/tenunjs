package id.my.tenun.embedder

/**
 * TenunEngine owns the native engine handle, JNI invocation, and transaction dispatching.
 */
class TenunEngine(bundleBytes: ByteArray? = null) {
    private var nativeHandle: Long = 0L

    init {
        nativeHandle = nativeInit(bundleBytes)
        check(nativeHandle != 0L) { "Failed to initialize Tenun native engine" }
    }

    @Synchronized
    fun dispatchAction(action: String, payloadJson: String = "{}"): String {
        check(nativeHandle != 0L) { "Engine already destroyed" }
        return nativeDispatchAction(nativeHandle, action, payloadJson)
    }

    @Synchronized
    fun getLatestScene(): String {
        check(nativeHandle != 0L) { "Engine already destroyed" }
        return nativeGetLatestScene(nativeHandle)
    }

    @Synchronized
    fun destroy() {
        if (nativeHandle != 0L) {
            nativeDestroy(nativeHandle)
            nativeHandle = 0L
        }
    }

    protected fun finalize() {
        destroy()
    }

    companion object {
        /** tenun_init_stage codes (must match tenun_android_bridge.h). */
        const val INIT_OK = 0
        const val INIT_ENGINE_ALLOC = 2
        const val INIT_SCRIPT_EVAL = 6

        /**
         * TEST-ONLY init-failure injection. Exists exclusively in builds
         * compiled with `-Ptenun.testInjection=true` (device acceptance
         * fail-visible stage); calling it in any other build throws —
         * the hook symbol is deliberately absent there.
         */
        @JvmStatic
        fun setTestInitInjection(stage: Int) {
            try {
                nativeSetTestInitInjection(stage)
            } catch (e: UnsatisfiedLinkError) {
                throw IllegalStateException(
                    "test injection requires a build with -Ptenun.testInjection=true",
                    e,
                )
            }
        }

        private external fun nativeSetTestInitInjection(stage: Int)

        init {
            try {
                System.loadLibrary("tenun_android")
            } catch (e: UnsatisfiedLinkError) {
                // Allows running under headless JVM test harnesses if library preloaded
            }
        }
    }

    private external fun nativeInit(bundleBytes: ByteArray?): Long
    private external fun nativeDispatchAction(handle: Long, action: String, payloadJson: String): String
    private external fun nativeGetLatestScene(handle: Long): String
    private external fun nativeDestroy(handle: Long)
}
