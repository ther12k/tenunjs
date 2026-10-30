package id.my.tenun.embedder

/**
 * TN-154: Host Service Bridge interface for synchronous capability invocations from JS:
 *   globalThis.tenun_host_call(service, method, payloadJson)
 */
fun interface HostServiceHandler {
    fun onHostCall(service: String, method: String, payloadJson: String): String?
}

/**
 * TenunEngine owns the native engine handle, JNI invocation, and transaction dispatching.
 */
class TenunEngine(
    bundleBytes: ByteArray? = null,
    hostHandler: HostServiceHandler? = null
) {
    private var nativeHandle: Long = 0L

    var hostServiceHandler: HostServiceHandler? = hostHandler
        @Synchronized set(value) {
            field = value
            if (nativeHandle != 0L) {
                nativeSetHostCallHandler(nativeHandle, value)
            }
        }

    init {
        nativeHandle = nativeInit(bundleBytes, hostHandler)
        check(nativeHandle != 0L) { "Failed to initialize Tenun native engine" }
    }

    @Synchronized
    fun dispatchAction(action: String, payloadJson: String = "{}"): String {
        check(nativeHandle != 0L) { "Engine already destroyed" }
        return nativeDispatchAction(nativeHandle, action, payloadJson)
    }

    /**
     * TN-150: the JS handler's RETURN VALUE for [action] — the data
     * channel for __TENUN_EXPORT (state snapshots) and
     * __TENUN_STATE_SCHEMA replies. Null when no handler exists, it
     * threw, or it returned a non-string; callers take their no-carry
     * path. [dispatchAction] instead returns the committed scene.
     */
    @Synchronized
    fun dispatchActionResult(action: String, payloadJson: String = "{}"): String? {
        check(nativeHandle != 0L) { "Engine already destroyed" }
        return nativeDispatchActionResult(nativeHandle, action, payloadJson)
    }

    @Synchronized
    fun getLatestScene(): String {
        check(nativeHandle != 0L) { "Engine already destroyed" }
        return nativeGetLatestScene(nativeHandle)
    }

    /** Lifecycle check for retained platform callbacks; never enters JNI. */
    val isDisposed: Boolean
        @Synchronized get() = nativeHandle == 0L

    @Synchronized
    fun destroy() {
        if (nativeHandle != 0L) {
            nativeSetHostCallHandler(nativeHandle, null)
            // TN-176: a REFUSED native destroy (same-engine reentry from
            // inside a host-service callback) keeps the handle — the
            // engine is still alive and usable; the owner retries after
            // the dispatch entry returns. Zeroing the handle here would
            // report a live engine as disposed and leak it.
            if (nativeDestroy(nativeHandle)) {
                nativeHandle = 0L
            }
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
                // Keep the underlying link error visible: a wrong build
                // flavor and a symbol-name mismatch must not read the same.
                throw IllegalStateException(
                    "test injection hook unavailable (requires a build with " +
                        "-Ptenun.testInjection=true): ${e.message}",
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

    private external fun nativeInit(bundleBytes: ByteArray?, handler: HostServiceHandler?): Long
    private external fun nativeDispatchAction(handle: Long, action: String, payloadJson: String): String
    private external fun nativeDispatchActionResult(handle: Long, action: String, payloadJson: String): String?
    private external fun nativeSetHostCallHandler(handle: Long, handler: HostServiceHandler?)
    private external fun nativeGetLatestScene(handle: Long): String

    /** TN-176: false when the destroy was refused (same-engine reentry
     * from inside a host-service callback) — the engine stays alive. */
    private external fun nativeDestroy(handle: Long): Boolean
}
