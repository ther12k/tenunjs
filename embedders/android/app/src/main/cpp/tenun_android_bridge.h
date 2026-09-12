#ifndef TENUN_ANDROID_BRIDGE_H
#define TENUN_ANDROID_BRIDGE_H

#if defined(__ANDROID__) || defined(ANDROID)
#include <jni.h>
#else
#include "test_jni_stubs.h"
#endif

#include <stdint.h>
#include <stddef.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct tenun_android_engine tenun_android_engine;

/*
 * Initialization failure stages (incident #191 diagnostics). Every early
 * return on the init failure path is attributable to exactly one stage;
 * success/failure behavior is unchanged by the instrumentation.
 */
typedef enum tenun_init_stage {
  TENUN_INIT_OK = 0,
  TENUN_INIT_INVALID_BUNDLE,   /* NULL/empty bundle bytes */
  TENUN_INIT_ENGINE_ALLOC,     /* calloc of the engine struct failed */
  TENUN_INIT_RUNTIME_CREATE,   /* JS_NewRuntime failed */
  TENUN_INIT_CONTEXT_CREATE,   /* JS_NewContext failed */
  TENUN_INIT_JNI_BUNDLE_READ,  /* JNI array access failed (Android only) */
  TENUN_INIT_SCRIPT_EVAL       /* JS_Eval raised (JS exception already logged) */
} tenun_init_stage;

/* Monotonic init attempt counter (diagnostic correlation id). */
long tenun_android_next_init_attempt(void);

#ifdef TENUN_TEST_INJECTION
/*
 * TEST-ONLY failure injection (incident #191 acceptance): compiled only
 * when the host test build defines TENUN_TEST_INJECTION. Never defined
 * for the Android (CMake) or NDK cross builds. No runtime toggle exists
 * in shipped artifacts.
 */
extern tenun_init_stage tenun_test_inject_init_failure;
#endif

/* Public Native Engine C API */
tenun_android_engine* tenun_android_engine_create(const uint8_t* bundle, size_t bundle_len);
char* tenun_android_engine_dispatch(tenun_android_engine* engine, const char* action, const char* payload_json);
const char* tenun_android_engine_get_scene(const tenun_android_engine* engine);
void tenun_android_engine_destroy(tenun_android_engine* engine);

/* JNI exports */
JNIEXPORT jlong JNICALL Java_id_my_tenun_embedder_TenunEngine_nativeInit(
    JNIEnv *env, jobject thiz, jbyteArray bundleBytes);

JNIEXPORT jstring JNICALL Java_id_my_tenun_embedder_TenunEngine_nativeDispatchAction(
    JNIEnv *env, jobject thiz, jlong handle, jstring action, jstring payloadJson);

JNIEXPORT jstring JNICALL Java_id_my_tenun_embedder_TenunEngine_nativeGetLatestScene(
    JNIEnv *env, jobject thiz, jlong handle);

JNIEXPORT void JNICALL Java_id_my_tenun_embedder_TenunEngine_nativeDestroy(
    JNIEnv *env, jobject thiz, jlong handle);

#ifdef __cplusplus
}
#endif

#endif /* TENUN_ANDROID_BRIDGE_H */
