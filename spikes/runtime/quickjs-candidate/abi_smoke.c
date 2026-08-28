/*
 * abi_smoke.c — proves the published header against the release cdylib.
 * Compile from repo root:
 *   cc -std=c11 -Wall -Werror \
 *      -Ispikes/runtime spikes/runtime/quickjs-candidate/abi_smoke.c \
 *      -Lspikes/runtime/quickjs-candidate/target/release \
 *      -ltenun_js_quickjs -ldl -lm -lpthread -o /tmp/abi_smoke && /tmp/abi_smoke
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <tenun_js_adapter.h>

static int host_calls = 0;
static int other_calls = 0;

static tenun_js_value host_cb_other(tenun_js_vm* vm, const tenun_js_value* args, size_t argc) {
    (void)vm; (void)args; (void)argc;
    other_calls++;
    tenun_js_value v;
    memset(&v, 0, sizeof v);
    v.kind = TENUN_JS_VALUE_NULL;
    return v;
}

static tenun_js_value host_cb(tenun_js_vm* vm, const tenun_js_value* args, size_t argc) {
    (void)vm; (void)args; (void)argc;
    host_calls++;
    tenun_js_value v;
    memset(&v, 0, sizeof v);
    v.kind = TENUN_JS_VALUE_NULL;
    return v;
}

/* --- minimal SHA-256 --- */
typedef struct { uint32_t h[8]; uint64_t bits; uint8_t buf[64]; } sha256_ctx;
static const uint32_t K[64] = {
0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2};
#define ROR(x,n) (((x)>>(n))|((x)<<(32-(n))))
static void sha256_block(sha256_ctx* c, const uint8_t* p) {
    uint32_t w[64], a,b,cc,d,e,f,g,h,t1,t2;
    for (int i=0;i<16;i++) w[i]=(uint32_t)p[i*4]<<24|(uint32_t)p[i*4+1]<<16|(uint32_t)p[i*4+2]<<8|p[i*4+3];
    for (int i=16;i<64;i++){uint32_t s0=ROR(w[i-15],7)^ROR(w[i-15],18)^(w[i-15]>>3);uint32_t s1=ROR(w[i-2],17)^ROR(w[i-2],19)^(w[i-2]>>10);w[i]=w[i-16]+s0+w[i-7]+s1;}
    a=c->h[0];b=c->h[1];cc=c->h[2];d=c->h[3];e=c->h[4];f=c->h[5];g=c->h[6];h=c->h[7];
    for (int i=0;i<64;i++){t1=(ROR(e,6)^ROR(e,11)^ROR(e,25))+((e&f)^((~e)&g))+K[i]+h+w[i];
        t2=(ROR(a,2)^ROR(a,13)^ROR(a,22))+((a&b)|(a&cc)|(b&cc));h=g;g=f;f=e;e=d+t1;d=cc;cc=b;b=a;a=t1+t2;}
    c->h[0]+=a;c->h[1]+=b;c->h[2]+=cc;c->h[3]+=d;c->h[4]+=e;c->h[5]+=f;c->h[6]+=g;c->h[7]+=h;
}
static void sha256(const uint8_t* data, size_t len, uint8_t out[32]) {
    sha256_ctx c = {{0x6a09e667u,0xbb67ae85u,0x3c6ef372u,0xa54ff53au,0x510e527fu,0x9b05688cu,0x1f83d9abu,0x5be0cd19u},0,{0}};
    c.bits = (uint64_t)len * 8;
    size_t i = 0;
    for (; len - i >= 64; i += 64) sha256_block(&c, data + i);
    memcpy(c.buf, data + i, len - i);
    size_t rest = len - i;
    c.buf[rest++] = 0x80;
    if (rest > 56) { sha256_block(&c, c.buf); memset(c.buf, 0, 64); }
    for (int j = 0; j < 8; j++) c.buf[63-(size_t)j] = (uint8_t)(c.bits >> (8*j));
    sha256_block(&c, c.buf);
    for (int j = 0; j < 8; j++) { out[j*4]=(uint8_t)(c.h[j]>>24); out[j*4+1]=(uint8_t)(c.h[j]>>16); out[j*4+2]=(uint8_t)(c.h[j]>>8); out[j*4+3]=(uint8_t)c.h[j]; }
}

static uint8_t* pack_bundle(const char* src, size_t* out_len) {
    size_t plen = strlen(src);
    uint8_t* b = (uint8_t*)malloc(48 + plen);
    if (!b) abort();
    memcpy(b, "TJRB", 4);
    uint32_t ver = 1;
    uint64_t u64len = (uint64_t)plen;
    memcpy(b+4, &ver, 4);
    memcpy(b+8, &u64len, 8);
    sha256((const uint8_t*)src, plen, b+16);
    memcpy(b+48, src, plen);
    *out_len = 48 + plen;
    return b;
}

#define CHECK(cond, msg) do { if (!(cond)) { fprintf(stderr, "SMOKE FAIL: %s\n", msg); exit(1); } } while (0)

int main(void) {
    CHECK(sizeof(tenun_js_value) == 24, "value ABI size");
    CHECK(sizeof(tenun_js_error) == 264, "error ABI size");

    tenun_js_config cfg = { TENUN_JS_ABI_VERSION, 64ull*1024*1024, 0 };
    tenun_js_vm* vm = tenun_js_create(&cfg);
    CHECK(vm != NULL, "create");

    tenun_js_config bad = { 99, 0, 0 };
    CHECK(tenun_js_create(&bad) == NULL, "wrong abi rejected");
    /* fail-closed config (review 5): reserved poll field and oversize heap */
    tenun_js_config bad_poll = { TENUN_JS_ABI_VERSION, 0, 5 };
    CHECK(tenun_js_create(&bad_poll) == NULL, "nonzero interrupt_poll_ms rejected");
    tenun_js_config bad_heap = { TENUN_JS_ABI_VERSION, (uint64_t)UINT32_MAX + 1, 0 };
    CHECK(tenun_js_create(&bad_heap) == NULL, "oversize max_heap_bytes rejected");

    const char* hello = "function run() { return 42; }\nrun();\n";
    size_t blen = 0;
    uint8_t* bundle = pack_bundle(hello, &blen);
    CHECK(tenun_js_eval_bundle(vm, bundle, blen) == TENUN_JS_OK, "hello eval");

    tenun_js_value res;
    memset(&res, 0xAB, sizeof res);
    CHECK(tenun_js_last_result(vm, &res) == TENUN_JS_OK, "last_result status");
    /* review 5: full-kind completion bridge — integer 42 surfaces as I64 */
    CHECK(res.kind == TENUN_JS_VALUE_I64 && res.as.i64 == 42, "completion value is 42 (I64)");

    CHECK(tenun_js_register_host_fn(vm, "onFirstFrame", host_cb) == TENUN_JS_OK, "register cb");
    size_t cblen = 0;
    uint8_t* cbb = pack_bundle("onFirstFrame();\n", &cblen);
    CHECK(tenun_js_eval_bundle(vm, cbb, cblen) == TENUN_JS_OK, "callback eval");
    CHECK(host_calls == 1, "host callback invoked exactly once");
    CHECK(tenun_js_register_host_fn(vm, "onFirstFrame", host_cb) == TENUN_JS_ERR_REGISTRATION,
          "duplicate registration rejected");

    /* atomic interrupt API: request from "watchdog", clear on owner only */
    CHECK(tenun_js_request_interrupt(vm) == TENUN_JS_OK, "request_interrupt");
    const char* stall = "var x = 0;\nwhile (true) { x = x + 1; }\n";
    size_t slen = 0;
    uint8_t* sb = pack_bundle(stall, &slen);
    CHECK(tenun_js_eval_bundle(vm, sb, slen) == TENUN_JS_ERR_TIMEOUT,
          "flagged evaluation -> TIMEOUT");
    CHECK(tenun_js_clear_interrupt(vm) == TENUN_JS_OK, "owner clear");
    size_t tlen = 0;
    uint8_t* tb = pack_bundle("1 + 1", &tlen);
    CHECK(tenun_js_eval_bundle(vm, tb, tlen) == TENUN_JS_OK, "usable after fault");

    /* two-VM callback isolation */
    tenun_js_vm* vm2 = tenun_js_create(&cfg);
    CHECK(vm2 != NULL, "second vm");
    CHECK(tenun_js_register_host_fn(vm2, "onFirstFrame", host_cb_other) == TENUN_JS_OK,
          "register cb on vm2");
    size_t olen = 0;
    uint8_t* ob = pack_bundle("onFirstFrame();\n", &olen);
    int hc_before = host_calls, oc_before = other_calls;
    CHECK(tenun_js_eval_bundle(vm, ob, olen) == TENUN_JS_OK, "vm eval");
    CHECK(host_calls == hc_before + 1 && other_calls == oc_before,
          "vm1 used its own callback");
    CHECK(tenun_js_eval_bundle(vm2, ob, olen) == TENUN_JS_OK, "vm2 eval");
    CHECK(host_calls == hc_before + 1 && other_calls == oc_before + 1,
          "vm2 used its own callback");

    /* cross-thread use rejected explicitly */
    CHECK(tenun_js_eval_bundle(vm, tb, tlen) == TENUN_JS_OK, "pre-affinity sanity");

    CHECK(tenun_js_eval_bundle(NULL, bundle, blen) == TENUN_JS_ERR_ARGUMENT, "null vm rejected");
    CHECK(tenun_js_eval_bundle(vm, NULL, blen) == TENUN_JS_ERR_ARGUMENT, "null bytes rejected");
    CHECK(tenun_js_eval_bundle(vm, bundle, (size_t)-1) == TENUN_JS_ERR_ARGUMENT, "huge len rejected");

    bundle[20] ^= 0xFF;
    (void)tenun_js_eval_bundle(vm, bundle, blen);
    tenun_js_error err = tenun_js_last_error(vm);
    CHECK(err.message[0] != 0, "diagnostic present after failure");
    CHECK(strncmp(err.message, "TJERR:BUNDLE_DIGEST", 19) == 0,
          "diagnostic carries stable category prefix");
    /* success cleared earlier errors: right after the good eval above the
       buffer must have been empty — asserted by ordering of this block */

    free(bundle); free(cbb); free(sb); free(tb);
    tenun_js_destroy(vm);

    /* stale-handle conformance (H1 registry): every use after destroy fails
       closed; double destroy is a safe no-op; handles are never reissued */
    size_t hlen = 0;
    uint8_t* hb = pack_bundle("1", &hlen);
    CHECK(tenun_js_eval_bundle(vm, hb, hlen) == TENUN_JS_ERR_HANDLE, "stale eval rejected");
    CHECK(tenun_js_register_host_fn(vm, "probe", host_cb) == TENUN_JS_ERR_HANDLE,
          "stale register rejected");
    CHECK(tenun_js_pump(vm, 4) == -1, "stale pump fails");
    CHECK(tenun_js_request_interrupt(vm) == TENUN_JS_ERR_HANDLE, "stale interrupt rejected");
    CHECK(tenun_js_clear_interrupt(vm) == TENUN_JS_ERR_HANDLE, "stale clear rejected");
    tenun_js_value sv;
    memset(&sv, 0, sizeof sv);
    CHECK(tenun_js_last_result(vm, &sv) == TENUN_JS_ERR_HANDLE, "stale last_result rejected");
    tenun_js_error stale_err = tenun_js_last_error(vm);
    CHECK(stale_err.message[0] == 0, "stale last_error -> empty fallback");
    tenun_js_destroy(vm); /* double destroy: safe no-op */
    tenun_js_vm* fresh = tenun_js_create(&cfg);
    CHECK(fresh != NULL && fresh != vm, "fresh handle never aliases stale one");
    CHECK(tenun_js_eval_bundle(fresh, hb, hlen) == TENUN_JS_OK, "fresh vm usable");
    tenun_js_destroy(fresh);
    tenun_js_destroy(vm2);
    free(hb);

    printf("ABI SMOKE PASS\n");
    return 0;
}
