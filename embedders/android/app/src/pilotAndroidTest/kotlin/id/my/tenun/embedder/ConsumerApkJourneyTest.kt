package id.my.tenun.embedder

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Test
import org.junit.runner.RunWith

/** Boots the packaged consumer through MainActivity and taps the production surface. */
@RunWith(AndroidJUnit4::class)
class ConsumerApkJourneyTest : DeviceAcceptanceBase() {
    @Test
    fun packagedConsumerRespondsToTaps() {
        val modified = when (val variant = InstrumentationRegistry.getArguments().getString("consumerVariant")) {
            "stock" -> false
            "modified" -> true
            else -> error("Expected consumerVariant=stock or modified, got $variant")
        }
        val scenario = launchApp()

        fun awaitText(vararg expected: String, rowStarts: List<String> = emptyList()) {
            awaitDisplayScene(scenario, 10_000, "consumer text: ${(expected.toList() + rowStarts).joinToString()}") { scene ->
                val texts = sceneTexts(scene)
                // The painter emits one text op per line; row labels may wrap.
                expected.all { it in texts } && rowStarts.all { prefix -> texts.any { it.startsWith(prefix) } }
            }
        }

        awaitText("Rehearsal Tasks", "0 of 0 done", if (modified) "Clear done" else "Clear completed")
        tapSceneText(scenario, "Add")
        awaitText("0 of 1 done", rowStarts = listOf("Read the"))
        tapSceneText(scenario, "Add")
        awaitText("0 of 2 done", rowStarts = listOf("Pack the"))
        tapSceneText(scenario, "Done")
        awaitText("1 of 2 done", rowStarts = listOf("✓ Read"))
        tapSceneText(scenario, "Toggle all")
        if (modified) {
            awaitText("1 of 2 done", rowStarts = listOf("Read the", "✓ Pack"))
        } else {
            awaitText("2 of 2 done", rowStarts = listOf("✓ Read", "✓ Pack"))
        }
    }
}
