#define _POSIX_C_SOURCE 200809L
#include "tenun_android_bridge.h"
#include "quickjs/quickjs.h"
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <pthread.h>

struct tenun_android_engine {
  JSRuntime* rt;
  JSContext* ctx;
  char* current_scene;
  pthread_mutex_t lock;
};

static JSValue js_tenun_commit(JSContext *ctx, JSValueConst this_val, int argc, JSValueConst *argv) {
  (void)this_val;
  tenun_android_engine* engine = (tenun_android_engine*)JS_GetContextOpaque(ctx);
  if (engine && argc > 0) {
    const char *scene = JS_ToCString(ctx, argv[0]);
    if (scene) {
      if (engine->current_scene) {
        free(engine->current_scene);
      }
      engine->current_scene = strdup(scene);
      JS_FreeCString(ctx, scene);
    }
  }
  return JS_UNDEFINED;
}

tenun_android_engine* tenun_android_engine_create(const uint8_t* bundle, size_t bundle_len) {
  if (!bundle || bundle_len == 0) return NULL;

  tenun_android_engine* engine = (tenun_android_engine*)calloc(1, sizeof(tenun_android_engine));
  if (!engine) return NULL;

  pthread_mutex_init(&engine->lock, NULL);

  engine->rt = JS_NewRuntime();
  if (!engine->rt) {
    free(engine);
    return NULL;
  }

  engine->ctx = JS_NewContext(engine->rt);
  if (!engine->ctx) {
    JS_FreeRuntime(engine->rt);
    free(engine);
    return NULL;
  }

  JS_SetContextOpaque(engine->ctx, engine);

  // Register host function: tenun_commit(sceneJson)
  JSValue global = JS_GetGlobalObject(engine->ctx);
  JSValue commit_fn = JS_NewCFunction(engine->ctx, js_tenun_commit, "tenun_commit", 1);
  JS_SetPropertyStr(engine->ctx, global, "tenun_commit", commit_fn);
  JS_FreeValue(engine->ctx, global);

  // Evaluate the real JavaScript application bundle
  JSValue eval_res = JS_Eval(engine->ctx, (const char*)bundle, bundle_len, "tenun_app.js", JS_EVAL_TYPE_GLOBAL);
  if (JS_IsException(eval_res)) {
    // Fail-closed on invalid JavaScript
    JSValue exc = JS_GetException(engine->ctx);
    const char *err = JS_ToCString(engine->ctx, exc);
    fprintf(stderr, "tenun-android-engine: JavaScript evaluation failed: %s\n", err ? err : "unknown error");
    if (err) JS_FreeCString(engine->ctx, err);
    JS_FreeValue(engine->ctx, exc);
    JS_FreeValue(engine->ctx, eval_res);

    JS_FreeContext(engine->ctx);
    JS_FreeRuntime(engine->rt);
    pthread_mutex_destroy(&engine->lock);
    free(engine);
    return NULL;
  }
  JS_FreeValue(engine->ctx, eval_res);

  return engine;
}

char* tenun_android_engine_dispatch(tenun_android_engine* engine, const char* action, const char* payload_json) {
  if (!engine || !engine->ctx || !action) return NULL;

  pthread_mutex_lock(&engine->lock);

  JSValue global = JS_GetGlobalObject(engine->ctx);
  JSValue dispatch_fn = JS_GetPropertyStr(engine->ctx, global, "__tenun_dispatch_action");

  if (JS_IsFunction(engine->ctx, dispatch_fn)) {
    JSValue args[2];
    args[0] = JS_NewString(engine->ctx, action);
    args[1] = JS_NewString(engine->ctx, payload_json ? payload_json : "{}");

    JSValue res = JS_Call(engine->ctx, dispatch_fn, global, 2, args);
    JS_FreeValue(engine->ctx, args[0]);
    JS_FreeValue(engine->ctx, args[1]);

    if (JS_IsException(res)) {
      JSValue exc = JS_GetException(engine->ctx);
      const char *err = JS_ToCString(engine->ctx, exc);
      fprintf(stderr, "tenun-android-engine: Action dispatch failed: %s\n", err ? err : "unknown error");
      if (err) JS_FreeCString(engine->ctx, err);
      JS_FreeValue(engine->ctx, exc);
    }
    JS_FreeValue(engine->ctx, res);
  }

  JS_FreeValue(engine->ctx, dispatch_fn);
  JS_FreeValue(engine->ctx, global);

  char* scene_copy = engine->current_scene ? strdup(engine->current_scene) : strdup("{}");
  pthread_mutex_unlock(&engine->lock);

  return scene_copy;
}

const char* tenun_android_engine_get_scene(const tenun_android_engine* engine) {
  if (!engine) return "{}";
  return engine->current_scene ? engine->current_scene : "{}";
}

void tenun_android_engine_destroy(tenun_android_engine* engine) {
  if (!engine) return;

  pthread_mutex_lock(&engine->lock);
  if (engine->current_scene) {
    free(engine->current_scene);
    engine->current_scene = NULL;
  }

  if (engine->ctx) {
    JS_FreeContext(engine->ctx);
    engine->ctx = NULL;
  }

  if (engine->rt) {
    JS_FreeRuntime(engine->rt);
    engine->rt = NULL;
  }

  pthread_mutex_unlock(&engine->lock);
  pthread_mutex_destroy(&engine->lock);
  free(engine);
}

/*
 * Robust JNI string conversions supporting arbitrary standard UTF-8 and 4-byte emojis (e.g. 😀).
 * Uses native Java UTF-16 on Android to completely bypass NewStringUTF Modified UTF-8 restrictions.
 */
#if defined(__ANDROID__) || defined(ANDROID)
static jstring tenun_jni_new_string(JNIEnv *env, const char *utf8_str) {
  if (!utf8_str) return (*env)->NewStringUTF(env, "");

  size_t in_len = strlen(utf8_str);
  jchar *u16 = (jchar*)malloc((in_len + 1) * sizeof(jchar) * 2);
  if (!u16) return (*env)->NewStringUTF(env, utf8_str);

  size_t out_len = 0;
  size_t i = 0;
  while (i < in_len) {
    uint8_t c = (uint8_t)utf8_str[i];
    if (c < 0x80) {
      u16[out_len++] = c;
      i += 1;
    } else if ((c & 0xE0) == 0xC0 && i + 1 < in_len) {
      uint32_t cp = ((c & 0x1F) << 6) | ((uint8_t)utf8_str[i+1] & 0x3F);
      u16[out_len++] = (jchar)cp;
      i += 2;
    } else if ((c & 0xF0) == 0xE0 && i + 2 < in_len) {
      uint32_t cp = ((c & 0x0F) << 12) | (((uint8_t)utf8_str[i+1] & 0x3F) << 6) | ((uint8_t)utf8_str[i+2] & 0x3F);
      u16[out_len++] = (jchar)cp;
      i += 3;
    } else if ((c & 0xF8) == 0xF0 && i + 3 < in_len) {
      // 4-byte code points (e.g. emojis): emitted as surrogate pairs in UTF-16
      uint32_t cp = ((c & 0x07) << 18) |
                    (((uint8_t)utf8_str[i+1] & 0x3F) << 12) |
                    (((uint8_t)utf8_str[i+2] & 0x3F) << 6) |
                    ((uint8_t)utf8_str[i+3] & 0x3F);
      cp -= 0x10000;
      u16[out_len++] = (jchar)(0xD800 + (cp >> 10));
      u16[out_len++] = (jchar)(0xDC00 + (cp & 0x3FF));
      i += 4;
    } else {
      u16[out_len++] = c;
      i += 1;
    }
  }

  jstring result = (*env)->NewString(env, u16, (jsize)out_len);
  free(u16);
  return result;
}

static char* tenun_jni_get_string(JNIEnv *env, jstring jstr) {
  if (!jstr) return NULL;
  jsize u16_len = (*env)->GetStringLength(env, jstr);
  const jchar *u16 = (*env)->GetStringChars(env, jstr, NULL);
  if (!u16) return NULL;

  char *utf8 = (char*)malloc(u16_len * 4 + 1);
  if (!utf8) {
    (*env)->ReleaseStringChars(env, jstr, u16);
    return NULL;
  }

  size_t out_len = 0;
  for (jsize i = 0; i < u16_len; i++) {
    uint32_t cp = u16[i];
    if (cp >= 0xD800 && cp <= 0xDBFF && i + 1 < u16_len) {
      uint32_t low = u16[i+1];
      if (low >= 0xDC00 && low <= 0xDFFF) {
        cp = 0x10000 + (((cp - 0xD800) << 10) | (low - 0xDC00));
        i++;
      }
    }
    if (cp < 0x80) {
      utf8[out_len++] = (char)cp;
    } else if (cp < 0x800) {
      utf8[out_len++] = (char)(0xC0 | (cp >> 6));
      utf8[out_len++] = (char)(0x80 | (cp & 0x3F));
    } else if (cp < 0x10000) {
      utf8[out_len++] = (char)(0xE0 | (cp >> 12));
      utf8[out_len++] = (char)(0x80 | ((cp >> 6) & 0x3F));
      utf8[out_len++] = (char)(0x80 | (cp & 0x3F));
    } else {
      utf8[out_len++] = (char)(0xF0 | (cp >> 18));
      utf8[out_len++] = (char)(0x80 | ((cp >> 12) & 0x3F));
      utf8[out_len++] = (char)(0x80 | ((cp >> 6) & 0x3F));
      utf8[out_len++] = (char)(0x80 | (cp & 0x3F));
    }
  }
  utf8[out_len] = '\0';
  (*env)->ReleaseStringChars(env, jstr, u16);
  return utf8;
}
#else
static jstring tenun_jni_new_string(JNIEnv *env, const char *utf8_str) {
  return (*env)->NewStringUTF(env, utf8_str ? utf8_str : "");
}

static char* tenun_jni_get_string(JNIEnv *env, jstring jstr) {
  if (!jstr) return NULL;
  const char *chars = (*env)->GetStringUTFChars(env, jstr, NULL);
  char *copy = chars ? strdup(chars) : NULL;
  if (chars) (*env)->ReleaseStringUTFChars(env, jstr, chars);
  return copy;
}
#endif

/* JNI Bindings */

JNIEXPORT jlong JNICALL Java_id_my_tenun_embedder_TenunEngine_nativeInit(
    JNIEnv *env, jobject thiz, jbyteArray bundleBytes) {
  (void)thiz;
  if (bundleBytes == NULL) return 0;

  jsize len = (*env)->GetArrayLength(env, bundleBytes);
  if (len <= 0) return 0;

  jbyte* bytes = (*env)->GetByteArrayElements(env, bundleBytes, NULL);
  if (!bytes) return 0;

  tenun_android_engine* engine = tenun_android_engine_create((const uint8_t*)bytes, (size_t)len);
  (*env)->ReleaseByteArrayElements(env, bundleBytes, bytes, JNI_ABORT);

  return (jlong)(intptr_t)engine;
}

JNIEXPORT jstring JNICALL Java_id_my_tenun_embedder_TenunEngine_nativeDispatchAction(
    JNIEnv *env, jobject thiz, jlong handle, jstring action, jstring payloadJson) {
  (void)thiz;
  tenun_android_engine* engine = (tenun_android_engine*)(intptr_t)handle;
  if (!engine) return tenun_jni_new_string(env, "{}");

  char* act_str = tenun_jni_get_string(env, action);
  char* pay_str = tenun_jni_get_string(env, payloadJson);

  char* updated_scene = tenun_android_engine_dispatch(engine, act_str, pay_str);

  if (act_str) free(act_str);
  if (pay_str) free(pay_str);

  jstring result = tenun_jni_new_string(env, updated_scene ? updated_scene : "{}");
  if (updated_scene) free(updated_scene);

  return result;
}

JNIEXPORT jstring JNICALL Java_id_my_tenun_embedder_TenunEngine_nativeGetLatestScene(
    JNIEnv *env, jobject thiz, jlong handle) {
  (void)thiz;
  tenun_android_engine* engine = (tenun_android_engine*)(intptr_t)handle;
  if (!engine) return tenun_jni_new_string(env, "{}");

  pthread_mutex_lock(&engine->lock);
  const char* scene = tenun_android_engine_get_scene(engine);
  jstring result = tenun_jni_new_string(env, scene);
  pthread_mutex_unlock(&engine->lock);

  return result;
}

JNIEXPORT void JNICALL Java_id_my_tenun_embedder_TenunEngine_nativeDestroy(
    JNIEnv *env, jobject thiz, jlong handle) {
  (void)env;
  (void)thiz;
  tenun_android_engine* engine = (tenun_android_engine*)(intptr_t)handle;
  if (engine) {
    tenun_android_engine_destroy(engine);
  }
}
