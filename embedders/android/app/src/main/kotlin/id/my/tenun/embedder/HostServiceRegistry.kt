package id.my.tenun.embedder

import java.util.concurrent.ConcurrentHashMap

/**
 * TN-154: Native platform service interface for Host Service Bridge.
 */
interface NativeService {
    fun invoke(method: String, payloadJson: String): String?
}

/**
 * TN-154: HostServiceRegistry coordinates native platform capabilities (BLE, etc.)
 * injected into the QuickJS runtime via HostServiceHandler.
 */
class HostServiceRegistry : HostServiceHandler {
    private val services = ConcurrentHashMap<String, NativeService>()

    fun register(name: String, service: NativeService) {
        services[name] = service
    }

    fun unregister(name: String) {
        services.remove(name)
    }

    override fun onHostCall(service: String, method: String, payloadJson: String): String? {
        val s = services[service] ?: return null
        return s.invoke(method, payloadJson)
    }
}
