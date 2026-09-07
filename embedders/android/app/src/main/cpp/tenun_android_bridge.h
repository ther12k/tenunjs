#ifndef TENUN_ANDROID_BRIDGE_H
#define TENUN_ANDROID_BRIDGE_H

#include <stdint.h>
#include <stddef.h>

#if defined(__ANDROID__) || defined(ANDROID)
#include <jni.h>
#else
/* Minimal JNI definitions for host headless testing without NDK sysroot conflicts */
typedef void* jobject;
typedef void* jclass;
typedef void* jstring;
typedef void* jbyteArray;
typedef int32_t jint;
typedef int64_t jlong;
typedef int32_t jsize;
typedef int8_t jbyte;
typedef uint8_t jboolean;

struct JNINativeInterface {
    void* reserved0;
    void* reserved1;
    void* reserved2;
    void* reserved3;
    jclass (*FindClass)(const struct JNINativeInterface**, const char*);
    void* reserved4[10];
    jstring (*NewStringUTF)(const struct JNINativeInterface**, const char*);
    jsize (*GetStringUTFLength)(const struct JNINativeInterface**, jstring);
    const char* (*GetStringUTFChars)(const struct JNINativeInterface**, jstring, jboolean*);
    void (*ReleaseStringUTFChars)(const struct JNINativeInterface**, jstring, const char*);
    jsize (*GetArrayLength)(const struct JNINativeInterface**, jbyteArray);
    void* reserved5[4];
    jbyte* (*GetByteArrayElements)(const struct JNINativeInterface**, jbyteArray, jboolean*);
    void* reserved6[7];
    void (*ReleaseByteArrayElements)(const struct JNINativeInterface**, jbyteArray, jbyte*, jint);
};

typedef const struct JNINativeInterface* JNIEnv;

#ifndef JNI_ABORT
#define JNI_ABORT 2
#endif

#ifndef JNIEXPORT
#define JNIEXPORT
#endif

#ifndef JNICALL
#define JNICALL
#endif
#endif

#ifdef __cplusplus
extern "C" {
#endif

typedef struct tenun_android_engine tenun_android_engine;

/* Public C API */
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
