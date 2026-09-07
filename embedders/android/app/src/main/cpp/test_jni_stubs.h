#ifndef TEST_JNI_STUBS_H
#define TEST_JNI_STUBS_H

#include <stdint.h>
#include <stddef.h>

/*
 * Host-only test doubles for headless execution without Bionic NDK sysroot conflicts.
 * NEVER included when compiling for Android (__ANDROID__ is defined).
 */
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
#define JNIEXPORT __attribute__((visibility("default")))
#endif

#ifndef JNICALL
#define JNICALL
#endif

#endif /* TEST_JNI_STUBS_H */
