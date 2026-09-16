package id.my.tenun.embedder

import android.app.Activity
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

/**
 * TenunJS prototype entry. Loads the application bundle from assets
 * (gallery_app.js preferred, notes reference tenun_app.js as the TN-132
 * acceptance fallback) and hosts the render surface.
 *
 * Dev hot reload: if the generated dev_server.txt asset is present, the
 * activity polls the laptop's dev server for a new bundle hash. On change
 * it exports the live screen states from the JS side, destroys the engine,
 * evaluates the fresh bundle, restores the states, and repaints —
 * Fast-Refresh semantics (new code, old state) on top of QuickJS, which
 * has no in-place code patching. Without dev_server.txt the activity never
 * touches the network and behaves as a plain offline application.
 */
class MainActivity : Activity() {
    private var engine: TenunEngine? = null
    private var surfaceView: TenunSurfaceView? = null

    private var devServerUrl: String? = null
    private var lastHash: String? = null
    private var assetBundleBytes: ByteArray? = null

    private val mainHandler = Handler(Looper.getMainLooper())
    private val ioExecutor = Executors.newSingleThreadExecutor { runnable ->
        Thread(runnable, "tenun-dev-reload").apply { isDaemon = true }
    }
    private val reloadInFlight = AtomicBoolean(false)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        assetBundleBytes = readAssetBundle()
        devServerUrl = readDevServerAsset()

        engine = TenunEngine(assetBundleBytes)
        surfaceView = TenunSurfaceView(this).apply {
            engine = this@MainActivity.engine
        }

        setContentView(surfaceView)

        if (devServerUrl != null) {
            Log.i(TAG, "dev hot reload enabled against $devServerUrl")
            schedulePoll(POLL_INTERVAL_MS)
        }
    }

    private fun readAssetBundle(): ByteArray? {
        return try {
            assets.open("gallery_app.js").use { it.readBytes() }
        } catch (e: Exception) {
            try {
                assets.open("tenun_app.js").use { it.readBytes() }
            } catch (e2: Exception) {
                null
            }
        }
    }

    /** One line: the dev server base URL, e.g. http://192.168.1.55:8898 */
    private fun readDevServerAsset(): String? {
        return try {
            assets.open("dev_server.txt").use { stream ->
                stream.readBytes().decodeToString().trim().ifEmpty { null }
            }
        } catch (e: Exception) {
            null
        }
    }

    private fun schedulePoll(delayMs: Long) {
        mainHandler.postDelayed({ pollTick() }, delayMs)
    }

    private fun pollTick() {
        val url = devServerUrl ?: return
        ioExecutor.execute {
            try {
                val hash = httpGetText("$url/hash")
                val known = lastHash
                lastHash = hash
                if (known != null && hash != known && reloadInFlight.compareAndSet(false, true)) {
                    val bytes = httpGetBytes("$url/gallery_app.js")
                    runOnUiThread {
                        try {
                            applyReload(bytes)
                        } finally {
                            reloadInFlight.set(false)
                            schedulePoll(POLL_INTERVAL_MS)
                        }
                    }
                    return@execute
                }
            } catch (e: Exception) {
                // Dev server unreachable is a normal state (laptop asleep,
                // offline testing); the app keeps running its current bundle.
                Log.d(TAG, "dev server unreachable: ${e.message}")
            }
            schedulePoll(POLL_INTERVAL_MS)
        }
    }

    /**
     * Swaps the engine to a freshly fetched bundle. The old engine is kept
     * alive just long enough to export live state, destroyed, the new
     * bundle evaluated, and state restored — in that order, because the
     * state only exists inside the old QuickJS runtime.
     */
    private fun applyReload(bytes: ByteArray) {
        try {
            val exported = engine?.dispatchAction("__TENUN_EXPORT", "{}")
            engine?.destroy()
            val fresh = TenunEngine(bytes)
            if (exported != null && exported.length > 2) {
                fresh.dispatchAction("TENUN_RESTORE", exported)
            }
            engine = fresh
            surfaceView?.engine = fresh
            Log.i(TAG, "hot reload applied (${bytes.size} bytes)")
        } catch (e: Exception) {
            Log.w(TAG, "hot reload failed, falling back to packaged bundle: ${e.message}")
            try {
                engine?.destroy()
            } catch (ignored: Exception) {
            }
            assetBundleBytes?.let { packaged ->
                engine = TenunEngine(packaged)
                surfaceView?.engine = engine
            }
        }
    }

    private fun httpGetText(url: String): String = String(httpGetBytes(url))

    private fun httpGetBytes(url: String): ByteArray {
        val connection = URL(url).openConnection() as HttpURLConnection
        try {
            connection.connectTimeout = 1500
            connection.readTimeout = 2500
            if (connection.responseCode != 200) {
                throw IllegalStateException("HTTP ${connection.responseCode} from $url")
            }
            connection.inputStream.use { input ->
                val output = ByteArrayOutputStream()
                input.copyTo(output, 16 * 1024)
                return output.toByteArray()
            }
        } finally {
            connection.disconnect()
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        mainHandler.removeCallbacksAndMessages(null)
        ioExecutor.shutdownNow()
        engine?.destroy()
        engine = null
    }

    companion object {
        private const val TAG = "TenunMainActivity"
        private const val POLL_INTERVAL_MS = 2500L
    }
}
