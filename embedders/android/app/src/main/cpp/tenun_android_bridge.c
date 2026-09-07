#define _POSIX_C_SOURCE 200809L
#include "tenun_android_bridge.h"
#include <stdlib.h>
#include <string.h>
#include <stdio.h>
#include <pthread.h>

#define MAX_SCENE_LEN 65536

struct tenun_android_engine {
  uint32_t generation;
  char* current_scene;
  pthread_mutex_t lock;
  /* State model for reference prototype app: Title, Details, Entries */
  char title[256];
  char details[256];
  char entries[32][512];
  size_t entry_count;
};

static void update_scene_locked(tenun_android_engine* engine) {
  if (!engine->current_scene) {
    engine->current_scene = (char*)malloc(MAX_SCENE_LEN);
  }

  char items_buf[MAX_SCENE_LEN / 2];
  items_buf[0] = '\0';
  size_t offset = 0;

  for (size_t i = 0; i < engine->entry_count; i++) {
    char entry_json[1024];
    snprintf(entry_json, sizeof(entry_json),
             "%s{\"id\":%zu,\"type\":\"listItem\",\"title\":\"%s\"}",
             (i > 0 ? "," : ""), 100 + i, engine->entries[i]);
    size_t len = strlen(entry_json);
    if (offset + len < sizeof(items_buf) - 1) {
      strcat(items_buf, entry_json);
      offset += len;
    }
  }

  snprintf(engine->current_scene, MAX_SCENE_LEN,
           "{\"root\":{\"id\":0,\"type\":\"column\",\"children\":["
           "{\"id\":1,\"type\":\"input\",\"field\":\"title\",\"value\":\"%s\"},"
           "{\"id\":2,\"type\":\"input\",\"field\":\"details\",\"value\":\"%s\"},"
           "{\"id\":3,\"type\":\"button\",\"text\":\"Add Entry\",\"action\":\"ADD_ENTRY\"}"
           "%s%s"
           "]},\"entryCount\":%zu,\"generation\":%u}",
           engine->title, engine->details,
           (engine->entry_count > 0 ? "," : ""), items_buf,
           engine->entry_count, engine->generation);
}

tenun_android_engine* tenun_android_engine_create(const uint8_t* bundle, size_t bundle_len) {
  (void)bundle;
  (void)bundle_len;

  tenun_android_engine* engine = (tenun_android_engine*)calloc(1, sizeof(tenun_android_engine));
  if (!engine) return NULL;

  pthread_mutex_init(&engine->lock, NULL);
  engine->generation = 1;
  engine->entry_count = 0;
  engine->title[0] = '\0';
  engine->details[0] = '\0';

  pthread_mutex_lock(&engine->lock);
  update_scene_locked(engine);
  pthread_mutex_unlock(&engine->lock);

  return engine;
}

char* tenun_android_engine_dispatch(tenun_android_engine* engine, const char* action, const char* payload_json) {
  if (!engine || !action) return NULL;

  pthread_mutex_lock(&engine->lock);

  if (strcmp(action, "SET_FIELD") == 0 && payload_json) {
    /* Extract field and value */
    const char* field_key = "\"field\":\"";
    const char* val_key = "\"value\":\"";
    const char* f_ptr = strstr(payload_json, field_key);
    const char* v_ptr = strstr(payload_json, val_key);

    if (f_ptr && v_ptr) {
      f_ptr += strlen(field_key);
      v_ptr += strlen(val_key);

      char field_name[32] = {0};
      char val_buf[256] = {0};

      sscanf(f_ptr, "%31[^\"]", field_name);
      sscanf(v_ptr, "%255[^\"]", val_buf);

      if (strcmp(field_name, "title") == 0) {
        strncpy(engine->title, val_buf, sizeof(engine->title) - 1);
        engine->generation++;
      } else if (strcmp(field_name, "details") == 0) {
        strncpy(engine->details, val_buf, sizeof(engine->details) - 1);
        engine->generation++;
      }
    }
  } else if (strcmp(action, "ADD_ENTRY") == 0) {
    if (strlen(engine->title) > 0 && engine->entry_count < 32) {
      char entry_content[1024];
      if (strlen(engine->details) > 0) {
        snprintf(entry_content, sizeof(entry_content), "%s - %s", engine->title, engine->details);
      } else {
        snprintf(entry_content, sizeof(entry_content), "%s", engine->title);
      }
      strncpy(engine->entries[engine->entry_count], entry_content, sizeof(engine->entries[0]) - 1);
      engine->entry_count++;
      engine->title[0] = '\0';
      engine->details[0] = '\0';
      engine->generation++;
    }
  }

  update_scene_locked(engine);
  char* result_copy = strdup(engine->current_scene);
  pthread_mutex_unlock(&engine->lock);

  return result_copy;
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
  pthread_mutex_unlock(&engine->lock);
  pthread_mutex_destroy(&engine->lock);
  free(engine);
}

/* JNI Bindings */

JNIEXPORT jlong JNICALL Java_id_my_tenun_embedder_TenunEngine_nativeInit(
    JNIEnv *env, jobject thiz, jbyteArray bundleBytes) {
  (void)thiz;
  jsize len = 0;
  jbyte* bytes = NULL;

  if (bundleBytes != NULL) {
    len = (*env)->GetArrayLength(env, bundleBytes);
    bytes = (*env)->GetByteArrayElements(env, bundleBytes, NULL);
  }

  tenun_android_engine* engine = tenun_android_engine_create((const uint8_t*)bytes, (size_t)len);

  if (bytes != NULL) {
    (*env)->ReleaseByteArrayElements(env, bundleBytes, bytes, JNI_ABORT);
  }

  return (jlong)(intptr_t)engine;
}

JNIEXPORT jstring JNICALL Java_id_my_tenun_embedder_TenunEngine_nativeDispatchAction(
    JNIEnv *env, jobject thiz, jlong handle, jstring action, jstring payloadJson) {
  (void)thiz;
  tenun_android_engine* engine = (tenun_android_engine*)(intptr_t)handle;
  if (!engine) return (*env)->NewStringUTF(env, "{}");

  const char* act_str = action ? (*env)->GetStringUTFChars(env, action, NULL) : NULL;
  const char* pay_str = payloadJson ? (*env)->GetStringUTFChars(env, payloadJson, NULL) : NULL;

  char* updated_scene = tenun_android_engine_dispatch(engine, act_str, pay_str);

  if (act_str) (*env)->ReleaseStringUTFChars(env, action, act_str);
  if (pay_str) (*env)->ReleaseStringUTFChars(env, payloadJson, pay_str);

  jstring result = (*env)->NewStringUTF(env, updated_scene ? updated_scene : "{}");
  if (updated_scene) free(updated_scene);

  return result;
}

JNIEXPORT jstring JNICALL Java_id_my_tenun_embedder_TenunEngine_nativeGetLatestScene(
    JNIEnv *env, jobject thiz, jlong handle) {
  (void)thiz;
  tenun_android_engine* engine = (tenun_android_engine*)(intptr_t)handle;
  if (!engine) return (*env)->NewStringUTF(env, "{}");

  pthread_mutex_lock(&engine->lock);
  const char* scene = tenun_android_engine_get_scene(engine);
  jstring result = (*env)->NewStringUTF(env, scene);
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
