/* Public-domain SHA-256 (FIPS 180-4), compact form. Used by both the
 * adapter (TJRB bundle digest verification) and the smoke runner
 * (bundle packing). Not constant-time; not a security boundary — the
 * adapter contract uses it for integrity, matching the QuickJS
 * candidate's sha2 usage. */
#ifndef TENUN_SHA256_H
#define TENUN_SHA256_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
  uint32_t state[8];
  uint64_t bitlen;
  uint8_t buffer[64];
  size_t buflen;
} tenun_sha256_ctx;

void tenun_sha256_init(tenun_sha256_ctx* ctx);
void tenun_sha256_update(tenun_sha256_ctx* ctx, const uint8_t* data, size_t len);
void tenun_sha256_final(tenun_sha256_ctx* ctx, uint8_t out[32]);
void tenun_sha256(const uint8_t* data, size_t len, uint8_t out[32]);

#endif

#ifdef __cplusplus
}
#endif
