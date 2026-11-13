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
 *     "requiredCapabilities": {"discovery": 1},
 *     "stateSchema": 1,
 *     "bundleFormat": "tenun-js-bundle-v1",
 *     "bundleSize": 102400,
 *     "bundleSha256": "<64 hex>",
 *     "bundleUrl": "https://..." }
 *
 * Gate order (see [verifyGates]): signature over exact bytes → parse →
 * schema/app/channel match → host-API + capability-requirement
 * compatibility → sequence newer than the accepted one and not
 * quarantined → download → size/digest match.
 *
 * Versioning discipline (TN-195):
 *   - HOST_API_VERSION is the COARSE host contract; bump it whenever the
 *     host's gate semantics or native surface change in a way old
 *     metadata cannot express. It is 2 since capability requirements
 *     exist; hosts at 1 ignore the field, so a requirement-bearing
 *     release must set hostApiMin ≥ REQUIREMENTS_MIN_HOST_API — enforced
 *     at parse time here and at publish time.
 *   - Per-capability contract versions ([NativeService.contractVersion])
 *     are the FINE grained gate: a release declares the minimum version
 *     of each capability it uses; the host refuses a bundle whose
 *     requirements it does not meet (missing capability or older
 *     contract) BEFORE download. Additive-compatible service changes
 *     keep their version; a breaking change bumps it and the release
 *     declares the new minimum.
 */
object UpdateProtocol {

    /**
     * Host API contract this APK implements; bump when native
     * capabilities or gate semantics change. 2 = capability-aware host
     * (enforces requiredCapabilities).
     */
    const val HOST_API_VERSION = 2

    /** First host API whose hosts enforce requiredCapabilities. */
    const val REQUIREMENTS_MIN_HOST_API = 2

    /** The only bundle format this host evaluates. */
    const val SUPPORTED_BUNDLE_FORMAT = "tenun-js-bundle-v1"

    /** Envelope schema this host accepts. */
    const val ENVELOPE_SCHEMA = 1

    /** Hard cap on downloaded bundle size (bytes) — DoS guard. */
    const val MAX_BUNDLE_BYTES = 50 * 1024 * 1024L

    /** Hard cap on the manifest envelope itself (bytes) — DoS guard. */
    const val MAX_MANIFEST_BYTES = 1024 * 1024L

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
        val bundleUrl: String,
        /** Capability name → minimum contract version this bundle needs. */
        val requiredCapabilities: Map<String, Int> = emptyMap()
    )

    data class HostIdentity(
        val appId: String,
        val channel: String,
        val hostApi: Int,
        /** Capability name → contract version this host provides. */
        val capabilities: Map<String, Int> = emptyMap()
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

            // Optional capability requirements (TN-195). Discipline: a
            // requirement-bearing release must target hosts that enforce
            // them — hosts at hostApi 1 ignore the field entirely, so
            // anything below REQUIREMENTS_MIN_HOST_API is malformed.
            val requiredCapabilities = HashMap<String, Int>()
            val requirements = obj.optJSONObject("requiredCapabilities")
            if (requirements != null) {
                val keys = requirements.keys()
                while (keys.hasNext()) {
                    val name = keys.next().trim()
                    val minVersion = requirements.optInt(name, -1)
                    if (name.isEmpty() || minVersion < 1) return null
                    requiredCapabilities[name] = minVersion
                }
            }
            if (requiredCapabilities.isNotEmpty() && hostApiMin < REQUIREMENTS_MIN_HOST_API) return null

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
                stateSchema, bundleFormat, bundleSize, bundleSha256, bundleUrl,
                requiredCapabilities
            )
        } catch (e: Exception) {
            null
        }
    }

    /**
     * App, channel, host-API, and capability-requirement compatibility gate
     * (signed fields only). A host that does not provide a required
     * capability at ≥ its declared minimum contract version refuses the
     * release BEFORE download — a bundle needing a new capability is
     * rejected by an old APK, not run by it.
     */
    fun isCompatible(metadata: ReleaseMetadata, host: HostIdentity): Boolean {
        if (metadata.appId != host.appId) return false
        if (metadata.channel != host.channel) return false
        if (host.hostApi < metadata.hostApiMin) return false
        val max = metadata.hostApiMax ?: metadata.hostApiMin
        if (host.hostApi > max) return false
        for ((name, minVersion) in metadata.requiredCapabilities) {
            val provided = host.capabilities[name] ?: return false
            if (provided < minVersion) return false
        }
        return true
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
     * Startup re-verification of a stored bundle against its cached signed
     * envelope: signature over exact payload bytes → parse → host/channel
     * compatibility → size/SHA-256 match of the stored bytes themselves.
     *
     * Download-time verification proves a release ONCE; this re-proves the
     * specific bytes that are about to boot — the cache may predate an APK
     * whose host API moved on, its meta may be tampered with, and its bytes
     * may have drifted on disk. Returns the verified metadata, or null when
     * the stored bundle must NOT boot.
     */
    fun storedBundleUsable(
        envelopeJson: String,
        publicKeyB64: String,
        host: HostIdentity,
        bytes: ByteArray
    ): ReleaseMetadata? {
        val metadata = parseEnvelope(envelopeJson, publicKeyB64) ?: return null
        if (!isCompatible(metadata, host)) return null
        if (!bundleMatches(metadata, bytes)) return null
        return metadata
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
