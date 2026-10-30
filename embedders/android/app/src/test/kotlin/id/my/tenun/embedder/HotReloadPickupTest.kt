package id.my.tenun.embedder

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * TN-178 dev-reload pickup decision (MainActivity.reloadWanted).
 *
 * The regression these tests pin: the first poll after launch used to only
 * RECORD the server hash, so a bundle deployed while the app was closed was
 * never fetched — the phone stayed on the old packaged bundle until the
 * server hash changed again while the app happened to be running.
 */
class HotReloadPickupTest {

    @Test
    fun firstPollAfterLaunchPicksUpBundleNewerThanTheBootedOne() {
        // Deploy landed while the app was closed: server hash differs from
        // the booted (packaged or stored-OTA) bundle → reload on first poll.
        assertTrue(
            MainActivity.reloadWanted(
                serverHash = "aa18a8452b00",
                lastHash = null,
                bootSha = "0f0c351ec000",
            ),
        )
    }

    @Test
    fun firstPollWithUnchangedBundleDoesNotReload() {
        assertFalse(
            MainActivity.reloadWanted(
                serverHash = "18a8452b0000",
                lastHash = null,
                bootSha = "18a8452b0000",
            ),
        )
    }

    @Test
    fun laterPollReloadsOnChangeOnly() {
        val boot = "18a8452b0000"
        // Hash changed while the app was running → reload…
        assertTrue(MainActivity.reloadWanted("aabbccdd0000", boot, boot))
        // …and not again once the new hash has been observed.
        assertFalse(MainActivity.reloadWanted("aabbccdd0000", "aabbccdd0000", boot))
    }

    @Test
    fun blankServerHashNeverTriggersAReload() {
        assertFalse(MainActivity.reloadWanted("", null, "18a8452b0000"))
        assertFalse(MainActivity.reloadWanted(null, "old", "18a8452b0000"))
        assertFalse(MainActivity.reloadWanted("  ", null, "18a8452b0000"))
    }

    @Test
    fun unknownBaselineKeepsLegacyRecordOnlyFirstPoll() {
        // Boot sha unavailable (asset bytes unreadable): the first poll must
        // not blind-fetch — same conservative behavior as before.
        assertFalse(MainActivity.reloadWanted("18a8452b0000", null, null))
    }
}
