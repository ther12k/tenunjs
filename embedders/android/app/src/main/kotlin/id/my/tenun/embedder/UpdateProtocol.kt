package id.my.tenun.embedder

import org.json.JSONObject
import java.util.Base64

/**
 * OTA wire protocol — signed release metadata envelope (JVM-pure).
 *
 * The served manifest is an ENVELOPE over exact signed bytes:
 *
 *   { "payload":   "<base64 of the ReleaseMetadata JSON bytes>",
 *     "signature": "<base64 ECDSA-SHA256 over those exact bytes>" }
 *
 * We verify the signature over the payload bytes FIRST and parse those
 * same verified bytes — never a re-serialization — so signer and verifier
 * cannot disagree about canonicalization.
 *
 * The signed metadata (not just the bundle) carries the anti-replay and
 * compatibility fields; replaying an old legitimately-signed manifest with
 * a bumped sequence fails the sequence gate, and a bundle for a different
 * host fails the compatibility gate:
 *
 *   { "schema": 1,
 *     "appId": "id.my.tenun.embedder",
 *     "channel": "prototype",
 *     "sequence": 42,
 *     "hostApiMin": 1, "hostApiMax": 1,
 *     "stateSchema": 1,
 *     "bundleFormat": "tenun-js-bundle-v1",
 *     "bundleSize": 102400,
 *     "bundleSha256": "<64 hex>",
 *     "bundleUrl": "https://..." }
 *
 * Gate order (see [verifyGates]): signature over exact bytes → parse →
 * schema/app/channel match → host-API compatibility → sequence newer than
 * the accepted one and not quarantined → download → size/digest match.
 */
object UpdateProtocol {

    /** Host API contract this APK implements; bump when native capabilities change. */
    const val HOST_API_VERSION = 1

    /** The only bundle format this host evaluates. */
    const val SUPPORTED_BUNDLE_FORMAT = "tenun-js-bundle-v1"

    /** Envelope schema this host accepts. */
    const val ENVELOPE_SCHEMA = 1

    /** Hard cap on downloaded bundle size (bytes) — DoS guard. */
    const val MAX_BUNDLE_BYTES = 50 * 1024 * 1024L

    data class ReleaseMetadata(
        val schema: Int,
        val appId: String,
        val channel: String,
        val sequence: Long,
        val hostApiMin: Int,
        val hostApiMax: Int?,
        val stateSchema: Long,
        val bundleFormat: String,
        val bundleSize: Long,
        val bundleSha256: String,
        val bundleUrl: String
    )

    data class HostIdentity(
        val appId: String,
        val channel: String,
        val hostApi: Int
    )

    /**
     * Verifies the envelope signature over the exact payload bytes and
     * parses those bytes into validated metadata. Returns null on ANY
     * defect (bad JSON, bad base64, bad signature, out-of-range fields) —
     * never throws.
     */
    fun parseEnvelope(manifestJson: String, publicKeyB64: String): ReleaseMetadata? {
        return try {
            val envelope = JSONObject(manifestJson)
            val payloadB64 = envelope.optString("payload")
            val signatureB64 = envelope.optString("signature")
            if (payloadB64.isEmpty() || signatureB64.isEmpty()) return null

            val payload = Base64.getDecoder().decode(payloadB64)
            val publicKey = BundleUpdateVerifier.decodePublicKey(publicKeyB64) ?: return null
            if (!BundleUpdateVerifier.verify(publicKey, payload, signatureB64)) return null

            parseMetadata(String(payload, Charsets.UTF_8))
        } catch (e: Exception) {
            null
        }
    }

    /** Parses and range-checks ReleaseMetadata JSON (already verified). */
    fun parseMetadata(json: String): ReleaseMetadata? {
        return try {
            val obj = JSONObject(json)
            val schema = obj.optInt("schema", -1)
            val appId = obj.optString("appId").trim()
            val channel = obj.optString("channel").trim()
            val sequence = obj.optLong("sequence", -1L)
            val hostApiMin = obj.optInt("hostApiMin", -1)
            val hasMax = obj.has("hostApiMax")
            val hostApiMax = if (hasMax) obj.optInt("hostApiMax", -1) else -1
            val stateSchema = obj.optLong("stateSchema", -1L)
            val bundleFormat = obj.optString("bundleFormat").trim()
            val bundleSize = obj.optLong("bundleSize", -1L)
            val bundleSha256 = obj.optString("bundleSha256").trim().lowercase()
            val bundleUrl = obj.optString("bundleUrl").trim()

            val wellFormed =
                schema == ENVELOPE_SCHEMA &&
                    appId.isNotEmpty() && channel.isNotEmpty() &&
                    sequence > 0L &&
                    hostApiMin >= 1 &&
                    (!hasMax || (hostApiMax >= hostApiMin)) &&
                    stateSchema > 0L &&
                    bundleFormat == SUPPORTED_BUNDLE_FORMAT &&
                    bundleSize in 1..MAX_BUNDLE_BYTES &&
                    bundleSha256.length == 64 && bundleSha256.all { it in '0'..'9' || it in 'a'..'f' } &&
                    (bundleUrl.startsWith("https://") || bundleUrl.startsWith("http://"))
            if (!wellFormed) return null

            ReleaseMetadata(
                schema, appId, channel, sequence,
                hostApiMin,
                if (hasMax) hostApiMax else null,
                stateSchema, bundleFormat, bundleSize, bundleSha256, bundleUrl
            )
        } catch (e: Exception) {
            null
        }
    }

    /** App, channel, and host-API compatibility gate (signed fields only). */
    fun isCompatible(metadata: ReleaseMetadata, host: HostIdentity): Boolean {
        if (metadata.appId != host.appId) return false
        if (metadata.channel != host.channel) return false
        if (host.hostApi < metadata.hostApiMin) return false
        val max = metadata.hostApiMax ?: metadata.hostApiMin
        return host.hostApi <= max
    }

    /** Strictly-monotonic sequence gate against the accepted sequence. */
    fun isNewer(metadata: ReleaseMetadata, acceptedSequence: Long): Boolean =
        metadata.sequence > acceptedSequence

    /** Size and digest verification of the downloaded bytes. */
    fun bundleMatches(metadata: ReleaseMetadata, bytes: ByteArray): Boolean {
        if (bytes.size.toLong() != metadata.bundleSize) return false
        return BundleUpdateVerifier.sha256Hex(bytes).equals(metadata.bundleSha256, ignoreCase = true)
    }

    /**
     * State carry gate: exported screen state may cross a bundle swap only
     * when both sides declare the same positive state schema. Anything else
     * restarts the JS app with clean state — schema migrations must be an
     * explicit designed mechanism, never an accident of OtaManager.
     */
    fun shouldRestore(oldStateSchema: Long, newStateSchema: Long): Boolean =
        oldStateSchema > 0L && oldStateSchema == newStateSchema
}
