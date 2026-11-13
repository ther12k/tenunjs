package id.my.tenun.embedder

import java.util.concurrent.ConcurrentHashMap

/**
 * TN-154: Native platform service interface for Host Service Bridge.
 *
 * TN-195: every service declares its CAPABILITY CONTRACT VERSION. The
 * version is the service's wire contract as the JS side sees it
 * (method names, request/response shapes, event payloads). Bump it when
 * that contract changes incompatibly; optional additive methods may keep
 * the version. OTA bundles declare requirements against these versions
 * (see [UpdateProtocol.ReleaseMetadata.requiredCapabilities]).
 */
interface NativeService {
    /** Wire-contract version of this capability (starts at 1). */
    val contractVersion: Int

    fun invoke(method: String, payloadJson: String): String?
}

/**
 * TN-154: HostServiceRegistry coordinates native platform capabilities (BLE, etc.)
 * injected into the QuickJS runtime via HostServiceHandler.
 *
 * TN-195: the registry doubles as the host's capability inventory —
 * [capabilitySnapshot] is what the OTA compatibility gate compares a
 * signed release's requirements against.
 */
class HostServiceRegistry : HostServiceHandler {
    private val services = ConcurrentHashMap<String, NativeService>()

    fun register(name: String, service: NativeService) {
        services[name] = service
    }

    fun unregister(name: String) {
        services.remove(name)
    }

    /** Capability name → contract version, as this build provides them. */
    fun capabilitySnapshot(): Map<String, Int> = services.mapValues { it.value.contractVersion }

    override fun onHostCall(service: String, method: String, payloadJson: String): String? {
        return try {
            val s = services[service] ?: return null
            s.invoke(method, payloadJson)
        } catch (e: Throwable) {
            null
        }
    }
}
