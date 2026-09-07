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
