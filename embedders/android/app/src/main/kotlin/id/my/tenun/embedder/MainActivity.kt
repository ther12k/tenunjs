package id.my.tenun.embedder

import android.app.Activity
import android.os.Bundle

class MainActivity : Activity() {
    private var engine: TenunEngine? = null
    private var surfaceView: TenunSurfaceView? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // Read app bundle from assets
        val bundleBytes = try {
            assets.open("tenun_app.js").use { it.readBytes() }
        } catch (e: Exception) {
            null
        }

        engine = TenunEngine(bundleBytes)
        surfaceView = TenunSurfaceView(this).apply {
            engine = this@MainActivity.engine
        }

        setContentView(surfaceView)
    }

    override fun onDestroy() {
        super.onDestroy()
        engine?.destroy()
        engine = null
    }
}
