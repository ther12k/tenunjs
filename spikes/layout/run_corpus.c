/*
 * run_corpus.c — one identical C driver for every layout candidate cdylib.
 * Usage: ./run_corpus <corpus.txt> <candidate.so>
 * Loads the adapter through dlopen so the same binary proves the published
 * header against each backend with zero candidate-specific code.
 */
#include <dlfcn.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <layout_adapter.h>

typedef tenun_layout_node* (*fn_node_create)(void);
typedef void (*fn_node_destroy)(tenun_layout_node*);
typedef tenun_layout_status (*fn_add_child)(tenun_layout_node*, tenun_layout_node*);
typedef tenun_layout_status (*fn_set_style)(tenun_layout_node*, const tenun_layout_style*);
typedef void (*fn_set_measure)(tenun_layout_node*, tenun_layout_measure_fn, void*);
typedef tenun_layout_status (*fn_compute)(tenun_layout_node*, float, float);
typedef const tenun_layout_box* (*fn_result)(const tenun_layout_node*);

static struct {
    fn_node_create create;
    fn_node_destroy destroy;
    fn_add_child add_child;
    fn_set_style set_style;
    fn_set_measure set_measure;
    fn_compute compute;
    fn_result result;
} api;

typedef struct { float w, h; } measure_slot;

static void stub_measure(void* userdata, tenun_layout_constraint c, tenun_layout_box* out) {
    (void)c;
    measure_slot* s = (measure_slot*)userdata;
    out->width = s->w;
    out->height = s->h;
}

#define MAX_NODES 256
#define MAX_EXPECT 64


/* ---- negative / lifecycle conformance (review 2, findings 1+3+7) ---- */
static int neg_failures = 0;
#define NEGCHECK(cond, msg) do { if (!(cond)) { printf("FAIL NEG %s\n", msg); neg_failures++; } } while (0)

static void run_negative_suite(void) {
    tenun_layout_node* A = api.create();
    tenun_layout_node* B = api.create();
    tenun_layout_node* C = api.create();
    tenun_layout_node* D = api.create();
    tenun_layout_style empty;
    memset(&empty, 0, sizeof empty);

    NEGCHECK(api.add_child(A, A) == TENUN_LAYOUT_ERR_TREE, "self-cycle");
    NEGCHECK(api.add_child(A, B) == TENUN_LAYOUT_OK, "attach A->B");
    NEGCHECK(api.add_child(B, A) == TENUN_LAYOUT_ERR_TREE, "cycle B->A");
    NEGCHECK(api.add_child(B, C) == TENUN_LAYOUT_OK, "attach B->C");
    NEGCHECK(api.add_child(C, A) == TENUN_LAYOUT_ERR_TREE, "deep cycle C->A");
    NEGCHECK(api.add_child(A, B) == TENUN_LAYOUT_ERR_TREE, "duplicate attach");
    NEGCHECK(api.add_child(D, B) == TENUN_LAYOUT_ERR_TREE, "reparent without detach");
    tenun_layout_style badstyle = empty;
    badstyle.direction = 7;
    NEGCHECK(api.set_style(C, &badstyle) == TENUN_LAYOUT_ERR_STYLE, "unknown enum");
    const tenun_layout_box* pre = api.result(B);
    NEGCHECK(pre->x == 0 && pre->y == 0 && pre->width == 0 && pre->height == 0,
             "precompute zeros");
    NEGCHECK(api.add_child(NULL, B) == TENUN_LAYOUT_ERR_TREE, "null parent");
    NEGCHECK(api.compute(NULL, 10, 10) == TENUN_LAYOUT_ERR_TREE, "null compute");

    /* destroy attached child detaches: parent stays computable, no dangling */
    api.destroy(B);
    NEGCHECK(api.add_child(D, C) == TENUN_LAYOUT_OK, "re-attach after destroy allowed");
    NEGCHECK(api.compute(A, 100, 100) == TENUN_LAYOUT_OK, "parent usable after child destroy");
    api.destroy(NULL);

    /* stale-handle conformance (H1 registry): every use after destroy fails
       closed; double destroy is a safe no-op; handles are never reissued */
    NEGCHECK(api.set_style(B, &empty) == TENUN_LAYOUT_ERR_HANDLE, "stale set_style");
    NEGCHECK(api.add_child(A, B) == TENUN_LAYOUT_ERR_HANDLE, "stale child attach");
    NEGCHECK(api.add_child(B, C) == TENUN_LAYOUT_ERR_HANDLE, "stale parent attach");
    NEGCHECK(api.compute(B, 10, 10) == TENUN_LAYOUT_ERR_HANDLE, "stale compute");
    NEGCHECK(api.result(B) == NULL, "stale result yields NULL");
    api.set_measure(B, stub_measure, NULL); /* stale set_measure: no-op, no crash */
    api.destroy(B);                          /* double destroy: safe no-op */
    tenun_layout_node* E = api.create();
    NEGCHECK(E != NULL && E != B, "fresh handle never aliases stale one");
    NEGCHECK(api.set_style(E, &empty) == TENUN_LAYOUT_OK, "fresh handle usable");

    if (neg_failures == 0) printf("ALL NEGATIVE CHECKS PASS\n");
}

int main(int argc, char** argv) {
    if (argc != 3) {
        fprintf(stderr, "usage: %s <corpus.txt> <candidate.so>\n", argv[0]);
        return 64;
    }
    void* so = dlopen(argv[2], RTLD_NOW);
    if (!so) {
        fprintf(stderr, "dlopen failed: %s\n", dlerror());
        return 1;
    }
    api.create = (fn_node_create)dlsym(so, "tenun_layout_node_create");
    api.destroy = (fn_node_destroy)dlsym(so, "tenun_layout_node_destroy");
    api.add_child = (fn_add_child)dlsym(so, "tenun_layout_node_add_child");
    api.set_style = (fn_set_style)dlsym(so, "tenun_layout_node_set_style");
    api.set_measure = (fn_set_measure)dlsym(so, "tenun_layout_node_set_measure");
    api.compute = (fn_compute)dlsym(so, "tenun_layout_compute");
    api.result = (fn_result)dlsym(so, "tenun_layout_result");
    if (!api.create || !api.destroy || !api.add_child || !api.set_style || !api.set_measure ||
        !api.compute || !api.result) {
        fprintf(stderr, "missing exported symbol: %s\n", dlerror());
        return 1;
    }

    FILE* f = fopen(argv[1], "r");
    if (!f) {
        perror("corpus file");
        return 1;
    }

    char line[512];
    int failures = 0, cases = 0;
    tenun_layout_node** nodes = calloc(MAX_NODES, sizeof(tenun_layout_node*));
    int* node_child_counts = calloc(MAX_NODES, sizeof(int));
    measure_slot* slots = calloc(MAX_NODES, sizeof(measure_slot));
    int ncount = 0;
    float vw = 0, vh = 0;
    tenun_layout_box expect[MAX_EXPECT];
    int ecount = 0;
    char case_id[64] = "";

    while (fgets(line, sizeof line, f)) {
        if (strncmp(line, "CASE ", 5) == 0) {
            sscanf(line + 5, "%63s", case_id);
            ncount = 0; ecount = 0;
        } else if (strncmp(line, "VIEWPORT ", 9) == 0) {
            sscanf(line + 9, "%f %f", &vw, &vh);
        } else if (strncmp(line, "NODE ", 5) == 0) {
            float w, h, grow, gap, pad;
            int child_count, dir, just, align;
            char rest[128] = "";
            sscanf(line + 5, "%d %f %f %f %d %f %f %d %d %127[^\n]",
                   &child_count, &w, &h, &grow, &dir, &gap, &pad, &just, &align, rest);
            tenun_layout_style st;
            memset(&st, 0, sizeof st);
            st.width = w; st.height = h; st.flex_grow = grow;
            st.direction = (tenun_layout_direction)dir;
            st.gap = gap; st.padding = pad;
            st.justify_content = (tenun_layout_justify)just;
            st.align_items = (tenun_layout_align)align;
            tenun_layout_node* n = api.create();
            if (!n || api.set_style(n, &st) != TENUN_LAYOUT_OK) {
                fprintf(stderr, "CASE %s: node/style failure\n", case_id);
                return 1;
            }
            if (strstr(rest, "MEASURE")) {
                float mw, mh;
                sscanf(strstr(rest, "MEASURE") + 7, "%f %f", &mw, &mh);
                slots[ncount].w = mw; slots[ncount].h = mh;
                api.set_measure(n, stub_measure, &slots[ncount]);
            }
            node_child_counts[ncount] = child_count;
            nodes[ncount++] = n;
        } else if (strncmp(line, "EXPECT ", 7) == 0) {
            tenun_layout_box e;
            sscanf(line + 7, "%f %f %f %f", &e.x, &e.y, &e.width, &e.height);
            expect[ecount++] = e;
        } else if (strncmp(line, "END", 3) == 0) {
            /* wire tree: preorder array -> child i attaches to nearest open parent */
            struct { int idx; int remaining; } open_[MAX_NODES];
            int sp = 0;
            open_[0].idx = 0;
            open_[0].remaining = node_child_counts[0];
            for (int i = 1; i < ncount; i++) {
                while (sp >= 0 && open_[sp].remaining == 0) sp--; /* branch complete */
                if (sp < 0 || open_[sp].remaining <= 0) {
                    fprintf(stderr, "CASE %s: inconsistent child counts at node %d\n", case_id, i);
                    return 1;
                }
                if (api.add_child(nodes[open_[sp].idx], nodes[i]) != TENUN_LAYOUT_OK) {
                    fprintf(stderr, "CASE %s: add_child failed at node %d\n", case_id, i);
                    return 1;
                }
                open_[sp].remaining--;
                sp++;
                open_[sp].idx = i;
                open_[sp].remaining = node_child_counts[i];
            }
            cases++;
            if (api.compute(nodes[0], vw, vh) != TENUN_LAYOUT_OK) {
                printf("FAIL %s compute\n", case_id);
                failures++;
                continue;
            }
            int bad = 0;
            if (ncount - 1 != ecount) {
                printf("FAIL %s: %d nodes vs %d expected boxes\n", case_id, ncount - 1, ecount);
                failures++;
                continue;
            }
            for (int i = 1; i < ncount; i++) {
                const tenun_layout_box* b = api.result(nodes[i]);
                tenun_layout_box e = expect[i - 1];
                if (memcmp(b, &e, sizeof e) != 0) bad = 1;
            }
            if (bad) {
                printf("FAIL %s\n", case_id);
                for (int i = 1; i < ncount && i - 1 < ecount; i++) {
                    const tenun_layout_box* b = api.result(nodes[i]);
                    printf("  expected (%g,%g,%g,%g) actual (%g,%g,%g,%g)\n",
                           expect[i-1].x, expect[i-1].y, expect[i-1].width, expect[i-1].height,
                           b->x, b->y, b->width, b->height);
                }
                failures++;
            } else {
                printf("PASS %s\n", case_id);
            }
        }
    }
    fclose(f);
    run_negative_suite();
    failures += neg_failures;
    free(nodes); free(slots);
    dlclose(so);
    if (failures) {
        printf("%d/%d cases failed\n", failures, cases);
        return 1;
    }
    printf("ALL %d CASES PASS via %s\n", cases, argv[2]);
    return 0;
}
