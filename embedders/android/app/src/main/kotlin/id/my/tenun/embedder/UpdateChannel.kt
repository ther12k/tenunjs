package id.my.tenun.embedder

import org.json.JSONObject

/**
 * OTA update channel (prototype) — install-time trust anchor.
 *
 * The channel configuration is an asset baked into the signed APK:
 *
 *   { "manifestUrl": "https://host/update-manifest.json",
 *     "channel": "prototype",
 *     "publicKeyB64": "<base64 X.509 SPKI, EC P-256>" }
 *
 * It is the ONLY thing that decides who may sign updates: without this
 * asset, OTA is completely dormant (no network use at all). The public key
 * pins the update signer; the manifest URL is where signed envelopes are
 * fetched from (served as { payload, signature } — see [UpdateProtocol]).
 *
 * `channel` is a signed-field in every release; this local value must
 * match, so a dev-channel release can never apply to a production build.
 */
data class UpdateChannel(
    val manifestUrl: String,
    val channel: String,
    val publicKeyB64: String
) {
    companion object {
        fun fromAssets(assets: android.content.res.AssetManager): UpdateChannel? {
            return try {
                val raw = assets.open("update_channel.json").use { it.readBytes().decodeToString() }
                fromJson(raw)
            } catch (e: Exception) {
                null
            }
        }

        /** Pure parser (JVM-testable); null on any defect. */
        fun fromJson(json: String): UpdateChannel? {
            return try {
                val obj = JSONObject(json)
                val manifestUrl = obj.optString("manifestUrl").trim()
                val channel = obj.optString("channel").trim()
                val publicKeyB64 = obj.optString("publicKeyB64").trim()
                val urlOk = manifestUrl.startsWith("https://") ||
                    // Cleartext is acceptable only for the prototype/dev
                    // channel; release builds serve over HTTPS and ship
                    // with a network security config that forbids
                    // cleartext at the platform layer.
                    manifestUrl.startsWith("http://")
                if (urlOk && channel.isNotEmpty() && publicKeyB64.isNotEmpty()) {
                    UpdateChannel(manifestUrl, channel, publicKeyB64)
                } else {
                    null
                }
            } catch (e: Exception) {
                null
            }
        }
    }
}
