package id.my.tenun.embedder

import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * TN-176 regression: the JNI host-handler setter and destroy must REFUSE
 * same-engine reentry (the TN-167 rule the C API already enforces)
 * instead of deadlocking on the mutex held across the dispatch entry.
 *
 * Pre-fix, a host service synchronously calling [TenunEngine.destroy] or
 * reassigning [TenunEngine.hostServiceHandler] from inside
 * [HostServiceHandler.onHostCall] deadlocked the dispatch thread
 * (ANR-shaped on main) — the C-only reentry tests never covered the JNI
 * setter. Post-fix the reentrant call is refused, the dispatch RETURNS,
 * and a refused destroy keeps the engine alive and usable (the Kotlin
 * handle stays honest); the owner destroys it after the entry returns.
 *
 * If the deadlock ever regresses, dispatchAction never returns and the
 * instrumentation watchdog fails this test — the hang IS the assertion.
 */
@RunWith(AndroidJUnit4::class)
class EngineReentryGuardTest {

    private val bundle = """
        (function () {
          function commit(tag) {
            tenun_commit(JSON.stringify({tenun:'display-list', version:1,
              designWidth:320, contentHeight:64, background:'#101014',
              ops:[{op:'text', x:0, y:32, text:String(tag), size:17,
                    weight:400, color:'#F2F2F7'}],
              taps:[]}));
          }
          globalThis.__tenun_dispatch_action = function (action, payloadJson) {
            var reply = tenun_host_call('reentry', action, payloadJson || '{}');
            commit(reply);
            return JSON.stringify({route:'reentry-test'});
          };
          commit('boot');
        })();
    """.trimIndent()

    @Test
    fun reentrantDestroyFromHostCallbackIsRefusedAndEngineStaysUsable() {
        var engineRef: TenunEngine? = null
        var calls = 0
        val handler = HostServiceHandler { service, method, _ ->
            assertEquals("reentry", service)
            if (method == "DESTROY") {
                calls++
                engineRef?.destroy() // reentrant: must be refused, not deadlock
            }
            "ok"
        }
        val engine = TenunEngine(bundle.toByteArray(Charsets.UTF_8), handler)
        engineRef = engine
        try {
            // Must RETURN (pre-fix: deadlock). Twice — the second proves the
            // refused destroy left the engine fully usable.
            assertNotNull(engine.dispatchAction("DESTROY", "{}"))
            assertNotNull(engine.dispatchAction("DESTROY", "{}"))
            assertEquals(2, calls)
            assertFalse("refused destroy must keep the engine alive", engine.isDisposed)
            assertTrue(engine.getLatestScene().contains("ok"))
        } finally {
            engine.destroy() // off-callback: must now succeed
        }
        assertTrue("post-entry destroy must succeed", engine.isDisposed)
    }

    @Test
    fun reentrantHandlerReplacementFromHostCallbackIsRefusedWithoutDeadlock() {
        var engineRef: TenunEngine? = null
        val handler = HostServiceHandler { service, _, _ ->
            assertEquals("reentry", service)
            // Reentrant setter: refused no-op (WARN logged native-side).
            engineRef?.hostServiceHandler = null
            "ok"
        }
        val engine = TenunEngine(bundle.toByteArray(Charsets.UTF_8), handler)
        engineRef = engine
        try {
            assertNotNull(engine.dispatchAction("REPLACE", "{}"))
            // The refused replacement left the ORIGINAL handler installed:
            // a second dispatch still reaches it.
            assertNotNull(engine.dispatchAction("REPLACE", "{}"))
            assertTrue(engine.getLatestScene().contains("ok"))
            assertFalse(engine.isDisposed)
        } finally {
            engine.destroy()
        }
        assertTrue(engine.isDisposed)
    }
}
