use sha2::{Digest, Sha256};

use std::sync::atomic::{AtomicU64, Ordering};
use tenun_js_quickjs::*;

static LAST_ARGC: AtomicU64 = AtomicU64::new(u64::MAX);
static LAST_KINDS: AtomicU64 = AtomicU64::new(0);
static LAST_I64: AtomicU64 = AtomicU64::new(0);
static LAST_STR: AtomicU64 = AtomicU64::new(0); // byte length
static LAST_B0: AtomicU64 = AtomicU64::new(999);

extern "C" fn host_probe(vm: *mut TenunJsVm, args: *const ValueC, argc: usize) -> ValueC {
    unsafe {
        for i in 0..argc.min(8) {
            let a = &*args.add(i);
            LAST_KINDS.fetch_or((a.kind as u64) << (i * 4), Ordering::SeqCst);
            match a.kind {
                // review 7: 42 arrives as Number → F64; store its bit pattern
                // (only arg0 — arg1 is 3.5 and would overwrite it)
                VK_F64 if i == 0 => LAST_I64.store(a.as_.f64v.to_bits(), Ordering::SeqCst),
                VK_I64 => LAST_I64.store(a.as_.i64v as u64, Ordering::SeqCst),
                VK_STRING if !a.as_.string.data.is_null() => {
                    let n = a.as_.string.len as u64;
                    LAST_STR.store(n, Ordering::SeqCst);
                }
                VK_BYTES if !a.as_.bytes.data.is_null() && a.as_.bytes.len > 0 => {
                    let b = a.as_.bytes.data.read();
                    LAST_B0.store(b as u64, Ordering::SeqCst);
                }
                _ => {}
            }
        }
        LAST_ARGC.store(argc as u64, Ordering::SeqCst);
    }
    let _ = vm;
    f64_value(1.0)
}

extern "C" fn host_eat(_vm: *mut TenunJsVm, _a: *const ValueC, _c: usize) -> ValueC {
    let mut out: ValueC = unsafe { std::mem::zeroed() };
    out.kind = VK_NULL;
    out
}

extern "C" fn host_a(_vm: *mut TenunJsVm, _a: *const ValueC, _c: usize) -> ValueC {
    f64_value(11.0)
}

extern "C" fn host_b(_vm: *mut TenunJsVm, _a: *const ValueC, _c: usize) -> ValueC {
    f64_value(22.0)
}

extern "C" fn ret_string(_vm: *mut TenunJsVm, _a: *const ValueC, _c: usize) -> ValueC {
    static PAYLOAD: &[u8] = b"ok";
    str_value(PAYLOAD)
}

extern "C" fn ret_bytes(_vm: *mut TenunJsVm, _a: *const ValueC, _c: usize) -> ValueC {
    static PAYLOAD: &[u8] = &[9u8, 8, 7];
    bytes_value(PAYLOAD)
}

extern "C" fn ret_bad_tag(_vm: *mut TenunJsVm, _a: *const ValueC, _c: usize) -> ValueC {
    let mut out: ValueC = unsafe { std::mem::zeroed() };
    out.kind = 99;
    out
}

extern "C" fn ret_oversize(_vm: *mut TenunJsVm, _a: *const ValueC, _c: usize) -> ValueC {
    static BIG: [u8; 70000] = [b'a'; 70000];
    let mut out: ValueC = unsafe { std::mem::zeroed() };
    out.kind = VK_STRING;
    out.as_.string = StrC {
        data: BIG.as_ptr(),
        len: BIG.len(),
    };
    out
}

extern "C" fn ret_null_data(_vm: *mut TenunJsVm, _a: *const ValueC, _c: usize) -> ValueC {
    let mut out: ValueC = unsafe { std::mem::zeroed() };
    out.kind = VK_STRING;
    out.as_.string = StrC {
        data: std::ptr::null(),
        len: 5,
    };
    out
}

extern "C" fn host_self_destroy(vm: *mut TenunJsVm, _a: *const ValueC, _c: usize) -> ValueC {
    // destroy our OWN VM while this callback is inside an evaluation
    unsafe { tenun_js_destroy(vm) }
    // Allocator churn (review 4): allocate and dirty many heap blocks; if VM
    // memory was prematurely freed, this churn would overwrite it before the
    // outer eval_checked frame resumes.
    let mut churn: Vec<Vec<u8>> = (0..1000).map(|i| vec![(i & 0xFF) as u8; 1024]).collect();
    churn.sort();
    std::hint::black_box(&churn);
    null_value()
}

static NEST_B_CALLS: std::sync::atomic::AtomicI32 = std::sync::atomic::AtomicI32::new(0);
static REENT_EVAL: std::sync::atomic::AtomicI32 = std::sync::atomic::AtomicI32::new(0);
static REENT_REG: std::sync::atomic::AtomicI32 = std::sync::atomic::AtomicI32::new(0);
static REENT_PUMP: std::sync::atomic::AtomicI64 = std::sync::atomic::AtomicI64::new(1);

extern "C" fn host_reenter(vm: *mut TenunJsVm, _a: *const ValueC, _c: usize) -> ValueC {
    let b = pack_bundle("1");
    unsafe {
        REENT_EVAL.store(
            tenun_js_eval_bundle(vm, b.as_ptr(), b.len()),
            Ordering::SeqCst,
        );
        REENT_REG.store(
            tenun_js_register_host_fn(vm, c"again".as_ptr() as *const u8, Some(host_a)),
            Ordering::SeqCst,
        );
        REENT_PUMP.store(tenun_js_pump(vm, 4), Ordering::SeqCst);
    }
    let mut out: ValueC = unsafe { std::mem::zeroed() };
    out.kind = VK_NULL;
    out
}

fn null_value() -> ValueC {
    let mut out: ValueC = unsafe { std::mem::zeroed() };
    out.kind = VK_NULL;
    out
}

fn f64_value(v: f64) -> ValueC {
    let mut out: ValueC = unsafe { std::mem::zeroed() };
    out.kind = VK_F64;
    out.as_.f64v = v;
    out
}

fn str_value(b: &'static [u8]) -> ValueC {
    let mut out: ValueC = unsafe { std::mem::zeroed() };
    out.kind = VK_STRING;
    out.as_.string = StrC {
        data: b.as_ptr(),
        len: b.len(),
    };
    out
}

fn bytes_value(b: &'static [u8]) -> ValueC {
    let mut out: ValueC = unsafe { std::mem::zeroed() };
    out.kind = VK_BYTES;
    out.as_.bytes = StrC {
        data: b.as_ptr(),
        len: b.len(),
    };
    out
}

fn pack_bundle(source: &str) -> Vec<u8> {
    let payload = source.as_bytes();
    let mut out = Vec::with_capacity(48 + payload.len());
    out.extend_from_slice(b"TJRB");
    out.extend_from_slice(&1u32.to_le_bytes());
    out.extend_from_slice(&(payload.len() as u64).to_le_bytes());
    out.extend_from_slice(&Sha256::digest(payload));
    out.extend_from_slice(payload);
    out
}

fn fail(msg: &str) -> ! {
    println!("FAIL {msg}");
    std::process::exit(1);
}

fn eval_st(vm: *mut TenunJsVm, src: &str) -> i32 {
    let b = pack_bundle(src);
    unsafe { tenun_js_eval_bundle(vm, b.as_ptr(), b.len()) }
}

fn eval_ok(vm: *mut TenunJsVm, src: &str) {
    let st = eval_st(vm, src);
    if st != TENUN_JS_OK {
        let e = unsafe { tenun_js_last_error(vm) };
        let m = String::from_utf8_lossy(&e.message).to_string();
        fail(&format!("eval '{src}' status={st} err={m}"));
    }
}

fn last_result(vm: *mut TenunJsVm) -> Option<f64> {
    let mut v: ValueC = unsafe { std::mem::zeroed() };
    unsafe { tenun_js_last_result(vm, &mut v) };
    // integer completions surface as VK_I64 (review 5 full-kind bridge)
    match v.kind {
        VK_F64 => Some(unsafe { v.as_.f64v }),
        VK_I64 => Some(unsafe { v.as_.i64v } as f64),
        _ => None,
    }
}

fn last_err(vm: *mut TenunJsVm) -> String {
    let e = unsafe { tenun_js_last_error(vm) };
    let n = e.message.iter().position(|&b| b == 0).unwrap_or(0);
    String::from_utf8_lossy(&e.message[..n]).to_string()
}

fn main() {
    unsafe {
        let cfg = ConfigC {
            abi_version: 1,
            max_heap_bytes: 64 * 1024 * 1024,
            interrupt_poll_ms: 0, // reserved field must be zero (review 5)
        };
        let bad_cfg = ConfigC {
            abi_version: 99,
            max_heap_bytes: 0,
            interrupt_poll_ms: 1,
        };

        println!("== create / abi + config rejection ==");
        if !tenun_js_create(&bad_cfg).is_null() {
            fail("wrong ABI version accepted");
        }
        // unsupported config values must fail closed (review 5)
        let bad_heap_cfg = ConfigC {
            abi_version: 1,
            max_heap_bytes: (u32::MAX as u64) + 1,
            interrupt_poll_ms: 0,
        };
        if !tenun_js_create(&bad_heap_cfg).is_null() {
            fail("oversized max_heap_bytes accepted");
        }
        let bad_poll_cfg = ConfigC {
            abi_version: 1,
            max_heap_bytes: 0,
            interrupt_poll_ms: 5,
        };
        if !tenun_js_create(&bad_poll_cfg).is_null() {
            fail("nonzero reserved interrupt_poll_ms accepted");
        }
        let ok_cfg = ConfigC {
            abi_version: 1,
            max_heap_bytes: 0,
            interrupt_poll_ms: 0,
        };
        let ok_vm = tenun_js_create(&ok_cfg);
        if ok_vm.is_null() {
            fail("documented supported config rejected");
        }
        tenun_js_destroy(ok_vm);
        println!("PASS unsupported heap/poll configs rejected; supported config accepted");
        let vm_a = tenun_js_create(&cfg);
        let vm_b = tenun_js_create(&cfg);
        if vm_a.is_null() || vm_b.is_null() {
            fail("vm creation");
        }

        println!("== two-VM callback isolation ==");
        if tenun_js_register_host_fn(vm_a, c"onFirstFrame".as_ptr() as *const u8, Some(host_a))
            != TENUN_JS_OK
            || tenun_js_register_host_fn(vm_b, c"onFirstFrame".as_ptr() as *const u8, Some(host_b))
                != TENUN_JS_OK
        {
            fail("registrations");
        }
        let cb_src = pack_bundle("onFirstFrame();\n");
        for round in 0..2 {
            eval_ok(vm_a, "onFirstFrame(); 11");
            if last_result(vm_a) != Some(11.0) {
                fail(&format!("round{round}: A != 11"));
            }
            eval_ok(vm_b, "onFirstFrame(); 22");
            if last_result(vm_b) != Some(22.0) {
                fail(&format!("round{round}: B != 22"));
            }
        }
        println!("PASS A→11 B→22 interleaved");

        println!("== exact diagnostics + clear-on-success ==");
        eval_ok(vm_a, "1");
        let mut bad = cb_src.clone();
        bad[20] ^= 0xFF;
        let st = tenun_js_eval_bundle(vm_a, bad.as_ptr(), bad.len());
        if st != TENUN_JS_ERR_BUNDLE_DIGEST || !last_err(vm_a).starts_with("TJERR:BUNDLE_DIGEST") {
            fail(&format!("digest st={st} err='{}'", last_err(vm_a)));
        }
        println!("PASS TJERR:BUNDLE_DIGEST verbatim");
        eval_ok(vm_a, "2");
        if !last_err(vm_a).is_empty() {
            fail("success must clear last_error");
        }
        println!("PASS clear-on-success");

        println!("== six-kind argument marshalling JS→host ==");
        let vm_c = tenun_js_create(&cfg);
        if vm_c.is_null() {
            fail("vm c");
        }
        if tenun_js_register_host_fn(vm_c, c"probe".as_ptr() as *const u8, Some(host_probe))
            != TENUN_JS_OK
        {
            fail("probe registration");
        }
        eval_ok(
            vm_c,
            "var ab = new ArrayBuffer(4); new Uint8Array(ab).set([9,9,9,9]);\n\
             probe(42, 3.5, true, null, 'h\\u00e9llo', ab);\n1",
        );
        if LAST_ARGC.load(Ordering::SeqCst) != 6 {
            fail(&format!(
                "argc={} (oversize/drop semantics broken?)",
                LAST_ARGC.load(Ordering::SeqCst)
            ));
        }
        let kinds = LAST_KINDS.load(Ordering::SeqCst);
        // review 7: source-type semantics — 42 is a JS Number → F64;
        // VK_I64 is reserved for BigInt
        let want = [
            VK_F64 as u64,
            VK_F64 as u64,
            VK_BOOL as u64,
            VK_NULL as u64,
            VK_STRING as u64,
            VK_BYTES as u64,
        ];
        for (i, w) in want.iter().enumerate() {
            let got = (kinds >> (i * 4)) & 0xF;
            if got != *w {
                fail(&format!("arg{i} kind {got} != {w}"));
            }
        }
        if f64::from_bits(LAST_I64.load(Ordering::SeqCst)) != 42.0 {
            fail("f64 arg value wrong");
        }
        // "héllo" is 6 UTF-8 bytes
        if LAST_STR.load(Ordering::SeqCst) != 6 {
            fail(&format!(
                "utf-8 strlen={} expected 6",
                LAST_STR.load(Ordering::SeqCst)
            ));
        }
        if LAST_B0.load(Ordering::SeqCst) != 9 {
            fail("array-buffer payload not visible");
        }
        println!("PASS f64(Number)/f64/bool/null/string(utf8)/bytes received intact");

        println!("== oversize JS→host string dropped with reduced argc ==");
        let big = "x".repeat(70_000);
        eval_ok(vm_c, &format!("probe(\"ok\", \"{big}\");\n1"));
        if LAST_ARGC.load(Ordering::SeqCst) != 1 {
            fail("oversized argument was not dropped");
        }
        println!("PASS oversized argument dropped; argc reflects conversion");

        println!("== host return kinds: string + array-buffer ==");
        struct RetCase {
            name: &'static [u8],
            f: extern "C" fn(*mut TenunJsVm, *const ValueC, usize) -> ValueC,
            src: &'static str,
            expect: f64,
        }
        let ret_cases = [
            RetCase { name: b"retStringOk\0", f: ret_string,
                      src: "if (retStringOk() !== 'ok') throw new Error('str'); 1", expect: 1.0 },
            RetCase { name: b"retBytesOk\0", f: ret_bytes,
                      src: "var rb = new Uint8Array(retBytesOk()); if (rb.length !== 3 || rb[0] !== 9) throw new Error('bytes'); 1",
                      expect: 1.0 },
        ];
        for rc in &ret_cases {
            let v = tenun_js_create(&cfg);
            if v.is_null() {
                fail("fresh return vm");
            }
            if tenun_js_register_host_fn(v, rc.name.as_ptr(), Some(rc.f)) != TENUN_JS_OK {
                fail("return-kind registration");
            }
            eval_ok(v, rc.src);
            if last_result(v) != Some(rc.expect) {
                fail("return-kind completion mismatch");
            }
            tenun_js_destroy(v);
        }
        println!("PASS string + array-buffer returns usable from JS");

        println!("== invalid tag / oversize / null-data returns throw TJERR ==");
        // one-fn-per-VM forbids extra names on vm_b; use fresh VM per case
        struct Case {
            name: &'static [u8],
            f: extern "C" fn(*mut TenunJsVm, *const ValueC, usize) -> ValueC,
            src: &'static str,
        }
        let cases = [
            Case {
                name: b"badTag\0",
                f: ret_bad_tag,
                src: "badTag();",
            },
            Case {
                name: b"bigStr\0",
                f: ret_oversize,
                src: "bigStr();",
            },
            Case {
                name: b"nullData\0",
                f: ret_null_data,
                src: "nullData();",
            },
        ];
        for case in &cases {
            let v = tenun_js_create(&cfg);
            if v.is_null() {
                fail("fresh vm");
            }
            if tenun_js_register_host_fn(v, case.name.as_ptr(), Some(case.f)) != TENUN_JS_OK {
                fail("case registration");
            }
            let st = eval_st(v, case.src);
            let e = last_err(v);
            if st != TENUN_JS_ERR_EVAL || !e.contains("TJERR:VALUE_BOUNDS") {
                fail(&format!("{}: st={st} err='{e}'", case.src));
            }
            tenun_js_destroy(v);
        }
        println!("PASS invalid tag / oversize / null-data rejected via TJERR throw");

        println!("== cross-thread request allowed, clear owner-only ==");
        let addr = vm_a as usize;
        let w = std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(120));
            tenun_js_request_interrupt(addr as *mut TenunJsVm)
        });
        let stall = pack_bundle("var x = 0;\nwhile (true) { x = x + 1; }\n");
        let t0 = std::time::Instant::now();
        let st = tenun_js_eval_bundle(vm_a, stall.as_ptr(), stall.len());
        let elapsed = t0.elapsed();
        if w.join().unwrap() != TENUN_JS_OK
            || st != TENUN_JS_ERR_TIMEOUT
            || elapsed.as_millis() < 100
        {
            fail(&format!("interrupt st={st} t={elapsed:?}"));
        }
        println!("PASS request_interrupt from watchdog → TIMEOUT in {elapsed:?}");
        let other = std::thread::spawn(move || tenun_js_clear_interrupt(addr as *mut TenunJsVm))
            .join()
            .unwrap();
        if other != TENUN_JS_ERR_AFFINITY {
            fail("cross-thread clear must be AFFINITY");
        }
        if tenun_js_clear_interrupt(vm_a) != TENUN_JS_OK {
            fail("owner clear");
        }
        eval_ok(vm_a, "3");
        println!("PASS owner clear restores VM");

        println!("== affinity: non-owner eval rejected ==");
        let a_addr = vm_a as usize;
        let st = std::thread::spawn(move || {
            let b = pack_bundle("1");
            tenun_js_eval_bundle(a_addr as *mut TenunJsVm, b.as_ptr(), b.len())
        })
        .join()
        .unwrap();
        if st != TENUN_JS_ERR_AFFINITY {
            fail(&format!("non-owner eval={st}"));
        }
        println!("PASS ERR_AFFINITY");

        println!("== duplicate registration + pump + null/oversize args ==");
        if tenun_js_register_host_fn(vm_a, c"onFirstFrame".as_ptr() as *const u8, Some(host_a))
            != TENUN_JS_ERR_REGISTRATION
        {
            fail("duplicate registration");
        }
        eval_ok(vm_a, "Promise.resolve().then(function(){});");
        if tenun_js_pump(vm_a, 16) < 1 {
            fail("pump drained nothing");
        }
        let _bundle = pack_bundle("1");
        let bundle = pack_bundle("1");
        if tenun_js_eval_bundle(std::ptr::null_mut(), bundle.as_ptr(), bundle.len())
            != TENUN_JS_ERR_ARGUMENT
            || tenun_js_eval_bundle(vm_a, std::ptr::null(), bundle.len()) != TENUN_JS_ERR_ARGUMENT
            || tenun_js_eval_bundle(vm_a, bundle.as_ptr(), usize::MAX) != TENUN_JS_ERR_ARGUMENT
        {
            fail("argument validation");
        }
        println!("PASS duplicate/pump/null/oversize all fail-closed");

        println!("== handle registry: stale + double destroy ==");
        let vm_h = tenun_js_create(&cfg);
        if vm_h.is_null() {
            fail("handle-registry vm");
        }
        let hb = pack_bundle("1");
        if tenun_js_eval_bundle(vm_h, hb.as_ptr(), hb.len()) != TENUN_JS_OK {
            fail("handle-registry vm unusable");
        }
        let stale = vm_h;
        tenun_js_destroy(vm_h);
        if tenun_js_eval_bundle(stale, hb.as_ptr(), hb.len()) != TENUN_JS_ERR_HANDLE {
            fail("stale eval must be ERR_HANDLE");
        }
        if tenun_js_register_host_fn(stale, c"probe".as_ptr() as *const u8, Some(host_a))
            != TENUN_JS_ERR_HANDLE
        {
            fail("stale register must be ERR_HANDLE");
        }
        if tenun_js_pump(stale, 4) != -1 {
            fail("stale pump must fail");
        }
        if tenun_js_request_interrupt(stale) != TENUN_JS_ERR_HANDLE {
            fail("stale interrupt must be ERR_HANDLE");
        }
        if tenun_js_clear_interrupt(stale) != TENUN_JS_ERR_HANDLE {
            fail("stale clear must be ERR_HANDLE");
        }
        let mut hv: ValueC = std::mem::zeroed();
        if tenun_js_last_result(stale, &mut hv) != TENUN_JS_ERR_HANDLE {
            fail("stale last_result must be ERR_HANDLE");
        }
        if !last_err(stale).is_empty() {
            fail("stale last_error must be the empty fallback");
        }
        tenun_js_destroy(stale); // double destroy: safe no-op
        let vm_h2 = tenun_js_create(&cfg);
        if vm_h2.is_null() || vm_h2 == stale {
            fail("fresh handle must never alias a destroyed one");
        }
        if tenun_js_eval_bundle(vm_h2, hb.as_ptr(), hb.len()) != TENUN_JS_OK {
            fail("fresh vm after destroys must be usable");
        }
        tenun_js_destroy(vm_h2);
        println!("PASS stale/double-destroy/alias all fail-closed");

        println!("== in-flight destruction + reentrancy (review 3) ==");
        let vm_x = tenun_js_create(&cfg);
        if vm_x.is_null() {
            fail("vm_x");
        }
        if tenun_js_register_host_fn(
            vm_x,
            c"selfDestruct".as_ptr() as *const u8,
            Some(host_self_destroy),
        ) != TENUN_JS_OK
        {
            fail("self-destruct registration");
        }
        // callback destroys its OWN VM mid-eval: eval completes over the
        // parked VM, handle dies immediately afterwards
        eval_ok(vm_x, "selfDestruct(); 7"); // completes over parked zombie
                                            // the now-dead handle gates every later read — including results
        if tenun_js_eval_bundle(vm_x, cb_src.as_ptr(), cb_src.len()) != TENUN_JS_ERR_HANDLE {
            fail("eval after in-flight destroy must be ERR_HANDLE");
        }
        if tenun_js_register_host_fn(vm_x, c"x2".as_ptr() as *const u8, Some(host_a))
            != TENUN_JS_ERR_HANDLE
        {
            fail("register after in-flight destroy must be ERR_HANDLE");
        }
        if tenun_js_clear_interrupt(vm_x) != TENUN_JS_ERR_HANDLE {
            fail("clear_interrupt after in-flight destroy must be ERR_HANDLE");
        }
        tenun_js_destroy(vm_x); // double destroy over parked zombie: safe no-op

        let vm_y = tenun_js_create(&cfg);
        if vm_y.is_null() {
            fail("vm_y");
        }
        if tenun_js_register_host_fn(vm_y, c"poke".as_ptr() as *const u8, Some(host_reenter))
            != TENUN_JS_OK
        {
            fail("reentrancy registration");
        }
        REENT_EVAL.store(0, Ordering::SeqCst);
        REENT_REG.store(0, Ordering::SeqCst);
        REENT_PUMP.store(1, Ordering::SeqCst);
        eval_ok(vm_y, "poke(); 3");
        if last_result(vm_y) != Some(3.0) {
            fail("reentrancy completion value");
        }
        if REENT_EVAL.load(Ordering::SeqCst) != TENUN_JS_ERR_HANDLE
            || REENT_REG.load(Ordering::SeqCst) != TENUN_JS_ERR_HANDLE
        {
            fail("reentrant eval/register must fail closed with ERR_HANDLE");
        }
        if REENT_PUMP.load(Ordering::SeqCst) != -1 {
            fail("reentrant pump must fail");
        }
        eval_ok(vm_y, "4"); // vm_y remains healthy
        tenun_js_destroy(vm_y);
        println!("PASS self-destroy mid-eval + reentrant calls all fail-closed");

        println!("== cross-VM nested evaluation (review 5) ==");
        // VM A's callback evaluates bundle code on VM B; when the callback
        // returns, VM A's context must be fully restored so subsequent host
        // calls inside A still resolve A's state.
        static NEST_B_EVAL: std::sync::atomic::AtomicI32 = std::sync::atomic::AtomicI32::new(0);
        extern "C" fn host_nested_b(vm_a: *mut TenunJsVm, _a: *const ValueC, _c: usize) -> ValueC {
            NEST_B_CALLS.fetch_add(1, Ordering::SeqCst);
            let vm_b = NEST_VM_B.load(Ordering::SeqCst) as *mut TenunJsVm;
            let b = pack_bundle("22");
            unsafe {
                NEST_B_EVAL.store(
                    tenun_js_eval_bundle(vm_b, b.as_ptr(), b.len()),
                    Ordering::SeqCst,
                );
            }
            let _ = vm_a;
            null_value()
        }
        static NEST_VM_B: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

        let vm_a2 = tenun_js_create(&cfg);
        let vm_b2 = tenun_js_create(&cfg);
        if vm_a2.is_null() || vm_b2.is_null() {
            fail("nested vms");
        }
        NEST_VM_B.store(vm_b2 as usize as u64, Ordering::SeqCst);
        if tenun_js_register_host_fn(vm_a2, c"evalB".as_ptr() as *const u8, Some(host_nested_b))
            != TENUN_JS_OK
        {
            fail("nested registration a");
        }
        // callback runs while A evaluates; inside it B evaluates fully
        eval_ok(vm_a2, "evalB(); 11");
        if NEST_B_EVAL.load(Ordering::SeqCst) != TENUN_JS_OK {
            fail("nested eval of B must succeed");
        }
        // B's completion must be visible on B and not on A
        if last_result(vm_b2) != Some(22.0) {
            fail("nested B completion value");
        }
        if last_result(vm_a2) != Some(11.0) {
            fail("outer A completion value after nested B");
        }
        // A's callback context restored: the SAME host function fires again
        // inside A and still resolves A's state (the counter increments to 2)
        eval_ok(vm_a2, "evalB(); 12");
        if NEST_B_CALLS.load(Ordering::SeqCst) != 2 {
            fail("trampoline lost context after nested evaluation");
        }
        if last_result(vm_a2) != Some(12.0) {
            fail("A completion after second callback");
        }
        tenun_js_destroy(vm_a2);
        tenun_js_destroy(vm_b2);
        println!("PASS cross-VM nested evaluation restores outer context");

        println!("== slot-reuse replacement VM after self-destroy (review 11) ==");
        {
            // A evaluates; its callback destroys A (slot freed, generation
            // bumped), creates B — which the free list hands A's slot back
            // with a new generation — then registers and evaluates on B.
            // B is a DIFFERENT VM instance: the nested calls must succeed,
            // not be rejected as same-VM reentrancy. Reentrancy identity is
            // the full handle (slot + generation), not the slot alone.
            static REPL_B_HANDLE: std::sync::atomic::AtomicU64 =
                std::sync::atomic::AtomicU64::new(0);
            static REPL_REG: std::sync::atomic::AtomicI32 = std::sync::atomic::AtomicI32::new(-99);
            static REPL_EVAL: std::sync::atomic::AtomicI32 = std::sync::atomic::AtomicI32::new(-99);
            extern "C" fn host_replace(
                vm_a: *mut TenunJsVm,
                _a: *const ValueC,
                _c: usize,
            ) -> ValueC {
                let cfg_b = ConfigC {
                    abi_version: 1,
                    max_heap_bytes: 64 * 1024 * 1024,
                    interrupt_poll_ms: 0,
                };
                unsafe {
                    tenun_js_destroy(vm_a); // A's slot returns to the free list
                    let vm_b = tenun_js_create(&cfg_b);
                    REPL_B_HANDLE.store(vm_b as usize as u64, Ordering::SeqCst);
                    REPL_REG.store(
                        tenun_js_register_host_fn(vm_b, c"rb".as_ptr() as *const u8, Some(host_a)),
                        Ordering::SeqCst,
                    );
                    let b = pack_bundle("5");
                    REPL_EVAL.store(
                        tenun_js_eval_bundle(vm_b, b.as_ptr(), b.len()),
                        Ordering::SeqCst,
                    );
                }
                null_value()
            }
            let vm_a3 = tenun_js_create(&cfg);
            if vm_a3.is_null() {
                fail("replace vm_a");
            }
            if tenun_js_register_host_fn(
                vm_a3,
                c"replace".as_ptr() as *const u8,
                Some(host_replace),
            ) != TENUN_JS_OK
            {
                fail("replace registration");
            }
            // outer evaluation completes over the parked A even though its
            // callback destroyed A mid-eval and ran a nested VM to completion
            eval_ok(vm_a3, "replace(); 9");
            let vm_b3 = REPL_B_HANDLE.load(Ordering::SeqCst) as *mut TenunJsVm;
            if vm_b3.is_null() {
                fail("replacement VM was not created");
            }
            // B reuses A's freed slot but with a bumped generation: a
            // DIFFERENT handle, so it is a different VM instance
            if vm_b3 == vm_a3 {
                fail("replacement VM must have a different handle (generation)");
            }
            if REPL_REG.load(Ordering::SeqCst) != TENUN_JS_OK {
                fail("registration on replacement VM must succeed");
            }
            if REPL_EVAL.load(Ordering::SeqCst) != TENUN_JS_OK {
                fail("nested eval on replacement VM must succeed (not reentrancy)");
            }
            // B is fully usable after A's outer evaluation finished
            eval_ok(vm_b3, "2");
            if last_result(vm_b3) != Some(2.0) {
                fail("replacement VM completion value");
            }
            tenun_js_destroy(vm_b3);
            tenun_js_destroy(vm_a3); // double destroy over parked A: no-op
        }
        println!("PASS replacement VM in freed slot nests legally (full-handle identity)");

        println!("== pumped host-call context + failure visibility (review 12) ==");
        {
            static PM_CALLS_B: AtomicU64 = AtomicU64::new(0);
            static PM_CALLS_A: AtomicU64 = AtomicU64::new(0);
            static PM_HANDLE: AtomicU64 = AtomicU64::new(0);
            // records which VM's callback ran during a pumped job
            extern "C" fn host_pm(vm: *mut TenunJsVm, args: *const ValueC, argc: usize) -> ValueC {
                PM_HANDLE.store(vm as usize as u64, Ordering::SeqCst);
                let n = if argc >= 1 {
                    unsafe { (*args).as_.f64v }
                } else {
                    0.0
                };
                if n == 33.0 {
                    PM_CALLS_B.fetch_add(1, Ordering::SeqCst);
                } else {
                    PM_CALLS_A.fetch_add(1, Ordering::SeqCst);
                }
                f64_value(1.0)
            }
            // -- (1) TOP-LEVEL pump: job scheduled at top level must invoke
            // B's callback with B's handle and its marshalled argument --
            let vm_b = tenun_js_create(&cfg);
            if vm_b.is_null() {
                fail("pump vm_b");
            }
            if tenun_js_register_host_fn(vm_b, c"pm".as_ptr() as *const u8, Some(host_pm))
                != TENUN_JS_OK
            {
                fail("pump registration b");
            }
            eval_ok(vm_b, "Promise.resolve().then(() => pm(33));");
            PM_CALLS_B.store(0, Ordering::SeqCst);
            PM_HANDLE.store(0, Ordering::SeqCst);
            let drained = tenun_js_pump(vm_b, 16);
            if drained < 1 {
                fail("pump drained nothing");
            }
            if PM_CALLS_B.load(Ordering::SeqCst) != 1 {
                fail("top-level pump must invoke B's host callback exactly once");
            }
            if PM_HANDLE.load(Ordering::SeqCst) != vm_b as usize as u64 {
                fail("pumped callback must receive B's handle");
            }
            println!("PASS top-level pump invokes the pumped VM's callback with its own handle");

            // -- (2) NESTED pump: A evaluates; A's host fn (its single
            // registration) pumps B; B's queued job must reach B's callback
            // (never A's) and A's context must be restored afterwards --
            static PM_A_DRAIN: std::sync::atomic::AtomicI64 = std::sync::atomic::AtomicI64::new(0);
            extern "C" fn host_pump_a(
                _vm_a: *mut TenunJsVm,
                _a: *const ValueC,
                _c: usize,
            ) -> ValueC {
                let vm_b = PM_B.load(Ordering::SeqCst) as *mut TenunJsVm;
                PM_A_DRAIN.store(unsafe { tenun_js_pump(vm_b, 16) }, Ordering::SeqCst);
                f64_value(1.0)
            }
            static PM_B: AtomicU64 = AtomicU64::new(0);
            eval_ok(vm_b, "Promise.resolve().then(() => pm(33));"); // queue on B
            let vm_a = tenun_js_create(&cfg);
            if vm_a.is_null() {
                fail("pump vm_a");
            }
            PM_B.store(vm_b as usize as u64, Ordering::SeqCst);
            if tenun_js_register_host_fn(vm_a, c"pumpB".as_ptr() as *const u8, Some(host_pump_a))
                != TENUN_JS_OK
            {
                fail("pump registration a");
            }
            PM_CALLS_B.store(0, Ordering::SeqCst);
            PM_CALLS_A.store(0, Ordering::SeqCst);
            PM_HANDLE.store(0, Ordering::SeqCst);
            PM_A_DRAIN.store(0, Ordering::SeqCst);
            // while A evaluates, its callback pumps B to completion
            eval_ok(
                vm_a,
                "var r = pumpB();\nif (r !== 1) throw new Error('pump drained ' + r);\n7",
            );
            if PM_A_DRAIN.load(Ordering::SeqCst) != 1 {
                fail("nested pump must drain B's single queued job");
            }
            if PM_CALLS_B.load(Ordering::SeqCst) != 1 {
                fail("nested pump must deliver B's queued job to B's callback");
            }
            if PM_CALLS_A.load(Ordering::SeqCst) != 0 {
                fail("nested pump must never invoke A's callback for B's job");
            }
            if PM_HANDLE.load(Ordering::SeqCst) != vm_b as usize as u64 {
                fail("nested pumped callback must receive B's handle");
            }
            // A's context fully restored: A's host fn still fires for A and
            // A's completion value survives the nested pump
            eval_ok(vm_a, "pumpB(); 8"); // B's queue is empty now: drains 0
            if PM_A_DRAIN.load(Ordering::SeqCst) != 0 {
                fail("second pump must drain nothing");
            }
            if last_result(vm_a) != Some(8.0) {
                fail("A completion after nested pump");
            }
            println!("PASS nested pump(B) inside A delivers B's job to B and restores A");

            tenun_js_destroy(vm_a);
            tenun_js_destroy(vm_b);
        }
        println!("== pending-job failure visibility (review 12) ==");
        {
            let vm = tenun_js_create(&cfg);
            if vm.is_null() {
                fail("pump-fail vm");
            }
            // a throw inside a PROMISE reaction is spec-captured (rejects
            // the derived promise — the job itself succeeds), so the
            // deterministic execute_pending_job Err trigger is a throwing
            // queueMicrotask callback: js_microtask_job returns the raw
            // JS_Call result, so the abrupt completion becomes a job error
            eval_ok(vm, "queueMicrotask(() => { throw new Error('boom'); });");
            let st = tenun_js_pump(vm, 16);
            if st != -1 {
                fail("pump with failing pending job must return -1");
            }
            let e = last_err(vm);
            if !e.starts_with("TJERR:EVAL") || !e.contains("pending job execution failed") {
                fail(&format!("pump failure diagnostic wrong: {e}"));
            }
            if !e.contains("boom") {
                fail(&format!("underlying exception text must be preserved: {e}"));
            }
            // the diagnostic is NOT silently cleared by a later no-op query
            if last_err(vm).is_empty() {
                fail("pump failure diagnostic was erased");
            }
            // documented recovery: a successful eval clears the diagnostic
            eval_ok(vm, "3");
            if !last_err(vm).is_empty() {
                fail("successful eval must clear the pump failure diagnostic");
            }
            tenun_js_destroy(vm);
        }
        println!("PASS failing pending job returns -1 with preserved TJERR:EVAL text");

        println!("== unhandled promise-rejection visibility (review 13) ==");
        {
            // (1) reaction throws, NO catch anywhere -> pump must promote
            // the unhandled rejection to a TJERR:EVAL failure
            let vm = tenun_js_create(&cfg);
            if vm.is_null() {
                fail("rej vm");
            }
            eval_ok(
                vm,
                "Promise.resolve().then(() => { throw new Error('boom'); });",
            );
            let st = tenun_js_pump(vm, 16);
            if st != -1 {
                fail("unhandled rejection must fail the pump turn");
            }
            let e = last_err(vm);
            if !e.starts_with("TJERR:EVAL") || !e.contains("unhandled promise rejection") {
                fail(&format!("unhandled-rejection diagnostic wrong: {e}"));
            }
            if !e.contains("boom") {
                fail(&format!("rejection reason text must be preserved: {e}"));
            }
            tenun_js_destroy(vm);

            // (2) reaction throws, catch attached in the SAME drain -> the
            // rejection is handled; the pump turn must succeed
            let vm = tenun_js_create(&cfg);
            if vm.is_null() {
                fail("rej2 vm");
            }
            eval_ok(
                vm,
                "Promise.resolve().then(() => { throw new Error('boom'); })\n .catch(() => {});",
            );
            if tenun_js_pump(vm, 16) < 1 {
                fail("handled rejection must not fail the pump turn");
            }
            if !last_err(vm).is_empty() {
                fail("handled rejection must leave no diagnostic");
            }
            tenun_js_destroy(vm);

            // (3) rejection unhandled at first, handler attached LATER ->
            // the handled transition removes the outstanding report and a
            // subsequent pump succeeds
            let vm = tenun_js_create(&cfg);
            if vm.is_null() {
                fail("rej3 vm");
            }
            eval_ok(vm, "var p = Promise.reject('late');\np.catch(() => {});");
            if tenun_js_pump(vm, 16) < 1 {
                fail("late-handled rejection must not fail the pump turn");
            }
            if !last_err(vm).is_empty() {
                fail("late-handled rejection must leave no diagnostic");
            }
            tenun_js_destroy(vm);

            // (4) primitive rejection reason -> exact JS textual form
            let vm = tenun_js_create(&cfg);
            if vm.is_null() {
                fail("rej4 vm");
            }
            eval_ok(vm, "Promise.reject(42);");
            if tenun_js_pump(vm, 16) != -1 {
                fail("primitive rejection must fail the pump turn");
            }
            let e = last_err(vm);
            if !e.contains("42") {
                fail(&format!("numeric rejection reason must be preserved: {e}"));
            }
            tenun_js_destroy(vm);

            // (5) multiple simultaneous unhandled rejections -> bounded,
            // deterministic report-order aggregation in ONE diagnostic
            let vm = tenun_js_create(&cfg);
            if vm.is_null() {
                fail("rej5 vm");
            }
            eval_ok(
                vm,
                "Promise.reject('a');\nPromise.reject('b');\nPromise.reject('c');",
            );
            if tenun_js_pump(vm, 16) != -1 {
                fail("multiple unhandled rejections must fail the pump turn");
            }
            let e = last_err(vm);
            if !(e.contains("(3)") && e.contains("a") && e.contains("b") && e.contains("c")) {
                fail(&format!("aggregated rejection diagnostic wrong: {e}"));
            }
            // a later successful pump clears the aggregated diagnostic
            if tenun_js_pump(vm, 16) < 0 {
                fail("follow-up pump must succeed");
            }
            if !last_err(vm).is_empty() {
                fail("follow-up pump must clear the rejection diagnostic");
            }
            tenun_js_destroy(vm);
        }
        println!("PASS unhandled rejections promoted at turn end; handled transitions clear");

        println!("== primitive thrown-value diagnostics (review 13) ==");
        {
            let vm = tenun_js_create(&cfg);
            if vm.is_null() {
                fail("ptext vm");
            }
            for (src, expect) in [
                ("queueMicrotask(() => { throw 42; });", "42"),
                ("queueMicrotask(() => { throw false; });", "false"),
                ("queueMicrotask(() => { throw null; });", "null"),
                ("queueMicrotask(() => { throw undefined; });", "undefined"),
                ("queueMicrotask(() => { throw 'str'; });", "str"),
                (
                    "queueMicrotask(() => { throw 9007199254740993n; });",
                    "9007199254740993",
                ),
                ("queueMicrotask(() => { throw Symbol('sym'); });", "sym"),
                (
                    "queueMicrotask(() => { throw {a: 1}; });",
                    "[object Object]",
                ),
                // a plain object's message getter never runs during
                // stringification — JS_ToString goes straight to
                // [object Object]. The conversion-throw path needs user
                // code to run INSIDE the coercion: a throwing toString().
                (
                    "queueMicrotask(() => { throw { toString() { throw new Error('x'); } }; });",
                    "pending job execution failed: exception",
                ),
            ] {
                eval_ok(vm, src);
                if tenun_js_pump(vm, 16) != -1 {
                    fail(&format!("throwing job must fail the pump: {src}"));
                }
                let e = last_err(vm);
                if !e.contains(expect) {
                    fail(&format!(
                        "diagnostic for {src} must contain '{expect}': got {e}"
                    ));
                }
            }
            // explicit truncation bound: a huge thrown string stays bounded
            eval_ok(vm, "queueMicrotask(() => { throw 'x'.repeat(10000); });");
            if tenun_js_pump(vm, 16) != -1 {
                fail("huge string throw must fail the pump");
            }
            let e = last_err(vm);
            if !(e.contains("xxxx") && e.len() < 255) {
                fail(&format!(
                    "huge string throw must be truncated: len={}",
                    e.len()
                ));
            }
            tenun_js_destroy(vm);
        }
        println!("PASS primitive thrown values carry exact bounded text (no generic 'exception')");

        println!("== rejection tracker state correctness (review 14) ==");
        {
            // (1) B handled BEFORE A: identity matching must remove B's
            // entry and keep A — FIFO remove(0) would delete A instead
            let vm = tenun_js_create(&cfg);
            if vm.is_null() {
                fail("trk vm");
            }
            eval_ok(
                vm,
                "const a = Promise.reject('A');\nconst b = Promise.reject('B');",
            );
            eval_ok(vm, "b.catch(function(){});");
            if tenun_js_pump(vm, 16) != -1 {
                fail("out-of-order: turn must fail for still-unhandled A");
            }
            let e = last_err(vm);
            if !e.contains("(1): A") || e.contains(": B") {
                fail(&format!("B-handled-first must report only A: {e}"));
            }
            tenun_js_destroy(vm);

            // (2) A handled before B -> B reported
            let vm = tenun_js_create(&cfg);
            if vm.is_null() {
                fail("trk2 vm");
            }
            eval_ok(
                vm,
                "const a = Promise.reject('A');\nconst b = Promise.reject('B');",
            );
            eval_ok(vm, "a.catch(function(){});");
            if tenun_js_pump(vm, 16) != -1 {
                fail("out-of-order 2: turn must fail for still-unhandled B");
            }
            let e = last_err(vm);
            if !e.contains("(1): B") || e.contains(": A") {
                fail(&format!("A-handled-first must report only B: {e}"));
            }
            tenun_js_destroy(vm);

            // (3) identical reasons: removal is driven by PROMISE identity,
            // not reason text — handling b leaves exactly one 'same' entry
            let vm = tenun_js_create(&cfg);
            if vm.is_null() {
                fail("trk3 vm");
            }
            eval_ok(
                vm,
                "const a = Promise.reject('same');\nconst b = Promise.reject('same');",
            );
            eval_ok(vm, "b.catch(function(){});");
            if tenun_js_pump(vm, 16) != -1 {
                fail("duplicate reasons: turn must fail for unhandled a");
            }
            let e = last_err(vm);
            if !e.contains("(1)") || !e.contains("same") {
                fail(&format!(
                    "duplicate reasons must leave exactly one entry: {e}"
                ));
            }
            tenun_js_destroy(vm);

            // (4) sticky overflow: 9 rejections -> 8 tracked + overflowed;
            // handling the UNTRACKED ninth must not delete tracked entries;
            // after all 8 tracked are handled, the turn STILL fails on the
            // sticky overflow flag
            let vm = tenun_js_create(&cfg);
            if vm.is_null() {
                fail("trk4 vm");
            }
            eval_ok(
                vm,
                "var p = Array.from({length: 9}, function(_, i) { return Promise.reject(String(i)); });",
            );
            // untracked promise handled first: defined no-op
            eval_ok(vm, "p[8].catch(function(){});");
            // now handle the 8 tracked ones
            eval_ok(vm, "for (var i = 0; i < 8; i++) p[i].catch(function(){});");
            if tenun_js_pump(vm, 16) != -1 {
                fail("overflow: turn must fail on the sticky overflow flag");
            }
            let e = last_err(vm);
            if !e.contains("exceeded 8 outstanding entries") {
                fail(&format!("overflow diagnostic wrong: {e}"));
            }
            // the overflow was reported; a follow-up turn succeeds
            eval_ok(vm, "1");
            if tenun_js_pump(vm, 16) < 0 {
                fail("post-overflow turn must succeed");
            }
            if !last_err(vm).is_empty() {
                fail("post-overflow diagnostic must be cleared");
            }
            tenun_js_destroy(vm);

            // (5) genuinely CROSS-TURN late handler: the rejection was
            // reported at turn end (records drained); the handled
            // transition arriving afterwards must be a safe no-op — never
            // a panic (remove(0) on an empty set)
            let vm = tenun_js_create(&cfg);
            if vm.is_null() {
                fail("trk5 vm");
            }
            eval_ok(vm, "globalThis.p = Promise.reject('late');");
            if tenun_js_pump(vm, 16) != -1 {
                fail("cross-turn: first turn must fail with the rejection");
            }
            // attach the handler AFTER the report, in a later adapter call
            eval_ok(vm, "p.catch(function(){});");
            eval_ok(vm, "2"); // VM healthy, no poisoning
            if tenun_js_pump(vm, 16) < 0 {
                fail("cross-turn: follow-up pump must succeed");
            }
            if !last_err(vm).is_empty() {
                fail("cross-turn: stale diagnostic must be cleared");
            }
            tenun_js_destroy(vm);

            // (6) interior NUL in thrown/rejected strings: the diagnostic
            // must carry BOTH sides (escaped for the C-string ABI)
            let vm = tenun_js_create(&cfg);
            if vm.is_null() {
                fail("trk6 vm");
            }
            eval_ok(
                vm,
                "queueMicrotask(function() { throw 'left\\u0000right'; });",
            );
            if tenun_js_pump(vm, 16) != -1 {
                fail("NUL throw: turn must fail");
            }
            let e = last_err(vm);
            if !(e.contains("left") && e.contains("right")) {
                fail(&format!("interior NUL must not truncate the text: {e}"));
            }
            eval_ok(vm, "Promise.reject('x\\u0000y');");
            if tenun_js_pump(vm, 16) != -1 {
                fail("NUL rejection: turn must fail");
            }
            let e = last_err(vm);
            if !(e.contains("x") && e.contains("y")) {
                fail(&format!("interior NUL rejection must keep both sides: {e}"));
            }
            tenun_js_destroy(vm);

            // (7) multibyte char crossing byte 255: last_error must
            // truncate at a UTF-8 boundary and leave byte 255 as the C
            // terminator
            let vm = tenun_js_create(&cfg);
            if vm.is_null() {
                fail("trk7 vm");
            }
            // 2 rejections x 60 'あ' (3 bytes, capped at 160 bytes per
            // reason) -> aggregate far exceeds 255 bytes, with a multibyte
            // char straddling byte 255 deterministically
            eval_ok(vm, "var a = Promise.reject('あ'.repeat(60));\nvar b = Promise.reject('あ'.repeat(60));");
            if tenun_js_pump(vm, 16) != -1 {
                fail("multibyte: turn must fail");
            }
            let e = tenun_js_last_error(vm);
            let nul = e.message.iter().position(|&c| c == 0).unwrap();
            // the aggregate must actually reach the payload cap (byte 254
            // or 255) so the straddling char is exercised
            if nul < 254 {
                fail(&format!(
                    "multibyte: aggregate did not reach the cap: {nul}"
                ));
            }
            if std::str::from_utf8(&e.message[..nul]).is_err() {
                fail("multibyte: diagnostic must not split a UTF-8 char at byte 255");
            }
            tenun_js_destroy(vm);
        }
        println!("PASS tracker keyed by promise identity; sticky overflow; safe late handlers");

        println!("== completion value bridge: all six kinds (review 5/6) ==");
        struct CompletionCase {
            src: &'static str,
            expect_kind: u32,
            expect_f64: Option<f64>,
            expect_i64: Option<i64>, // exact integer assertion (review 6)
            expect_bool: Option<bool>,
            expect_bytes: Option<&'static [u8]>,
        }
        let cases = [
            CompletionCase {
                src: "null",
                expect_kind: VK_NULL,
                expect_f64: None,
                expect_i64: None,
                expect_bool: None,
                expect_bytes: None,
            },
            CompletionCase {
                src: "true",
                expect_kind: VK_BOOL,
                expect_f64: None,
                expect_i64: None,
                expect_bool: Some(true),
                expect_bytes: None,
            },
            CompletionCase {
                src: "1.5",
                expect_kind: VK_F64,
                expect_f64: Some(1.5),
                expect_i64: None,
                expect_bool: None,
                expect_bytes: None,
            },
            CompletionCase {
                src: "1.5e10",
                expect_kind: VK_F64,
                expect_f64: Some(1.5e10),
                expect_i64: None,
                expect_bool: None,
                expect_bytes: None,
            },
            // JS Number literals keep their origin type: f64 semantics
            // (2^53+1 rounds AT PARSE TIME — that is JS, not the bridge)
            CompletionCase {
                src: "9007199254740993",
                expect_kind: VK_F64,
                expect_f64: Some(9007199254740992.0),
                expect_i64: None,
                expect_bool: None,
                expect_bytes: None,
            },
            // BigInt literals bridge EXACTLY (review 6)
            // review 7: plain Number 42 → F64 (source-type model)
            CompletionCase {
                src: "42",
                expect_kind: VK_F64,
                expect_f64: Some(42.0),
                expect_i64: None,
                expect_bool: None,
                expect_bytes: None,
            },
            CompletionCase {
                src: "0",
                expect_kind: VK_F64,
                expect_f64: Some(0.0),
                expect_i64: None,
                expect_bool: None,
                expect_bytes: None,
            },
            CompletionCase {
                src: "-1",
                expect_kind: VK_F64,
                expect_f64: Some(-1.0),
                expect_i64: None,
                expect_bool: None,
                expect_bytes: None,
            },
            CompletionCase {
                src: "2147483647",
                expect_kind: VK_F64,
                expect_f64: Some(2147483647.0),
                expect_i64: None,
                expect_bool: None,
                expect_bytes: None,
            },
            CompletionCase {
                src: "9007199254740991",
                expect_kind: VK_F64,
                expect_f64: Some(9007199254740991.0),
                expect_i64: None,
                expect_bool: None,
                expect_bytes: None,
            },
            CompletionCase {
                src: "0n",
                expect_kind: VK_I64,
                expect_f64: None,
                expect_i64: Some(0),
                expect_bool: None,
                expect_bytes: None,
            },
            CompletionCase {
                src: "42n",
                expect_kind: VK_I64,
                expect_f64: None,
                expect_i64: Some(42),
                expect_bool: None,
                expect_bytes: None,
            },
            CompletionCase {
                src: "-1n",
                expect_kind: VK_I64,
                expect_f64: None,
                expect_i64: Some(-1),
                expect_bool: None,
                expect_bytes: None,
            },
            CompletionCase {
                src: "2147483647n",
                expect_kind: VK_I64,
                expect_f64: None,
                expect_i64: Some(2147483647),
                expect_bool: None,
                expect_bytes: None,
            },
            CompletionCase {
                src: "9007199254740991n",
                expect_kind: VK_I64,
                expect_f64: None,
                expect_i64: Some(9007199254740991),
                expect_bool: None,
                expect_bytes: None,
            },
            CompletionCase {
                src: "123n",
                expect_kind: VK_I64,
                expect_f64: None,
                expect_i64: Some(123),
                expect_bool: None,
                expect_bytes: None,
            },
            CompletionCase {
                src: "2147483648n", // i32::MAX + 1
                expect_kind: VK_I64,
                expect_f64: None,
                expect_i64: Some(2147483648),
                expect_bool: None,
                expect_bytes: None,
            },
            CompletionCase {
                src: "-2147483649n", // i32::MIN - 1
                expect_kind: VK_I64,
                expect_f64: None,
                expect_i64: Some(-2147483649),
                expect_bool: None,
                expect_bytes: None,
            },
            CompletionCase {
                src: "9007199254740991n", // 2^53 - 1
                expect_kind: VK_I64,
                expect_f64: None,
                expect_i64: Some(9007199254740991),
                expect_bool: None,
                expect_bytes: None,
            },
            CompletionCase {
                src: "9007199254740993n", // 2^53 + 1: the precision case
                expect_kind: VK_I64,
                expect_f64: None,
                expect_i64: Some(9007199254740993),
                expect_bool: None,
                expect_bytes: None,
            },
            CompletionCase {
                src: "-9007199254740993n",
                expect_kind: VK_I64,
                expect_f64: None,
                expect_i64: Some(-9007199254740993),
                expect_bool: None,
                expect_bytes: None,
            },
            CompletionCase {
                src: "9223372036854775807n", // i64::MAX
                expect_kind: VK_I64,
                expect_f64: None,
                expect_i64: Some(i64::MAX),
                expect_bool: None,
                expect_bytes: None,
            },
            CompletionCase {
                src: "-9223372036854775808n", // i64::MIN
                expect_kind: VK_I64,
                expect_f64: None,
                expect_i64: Some(i64::MIN),
                expect_bool: None,
                expect_bytes: None,
            },
            CompletionCase {
                src: "'h\\u00e9llo'",
                expect_kind: VK_STRING,
                expect_f64: None,
                expect_i64: None,
                expect_bool: None,
                expect_bytes: None,
            },
            CompletionCase {
                src: "var ab = new ArrayBuffer(3); new Uint8Array(ab).set([7,8,9]); ab",
                expect_kind: VK_BYTES,
                expect_f64: None,
                expect_i64: None,
                expect_bool: None,
                expect_bytes: Some(&[7u8, 8, 9]),
            },
        ];
        for (i, case) in cases.iter().enumerate() {
            let vm = tenun_js_create(&cfg);
            if vm.is_null() {
                fail("completion vm");
            }
            eval_ok(vm, case.src);
            let mut v: ValueC = std::mem::zeroed();
            if tenun_js_last_result(vm, &mut v) != TENUN_JS_OK {
                fail(&format!("case {i}: last_result failed"));
            }
            if v.kind != case.expect_kind {
                fail(&format!(
                    "case {i}: kind {} != {}",
                    v.kind, case.expect_kind
                ));
            }
            match case.expect_kind {
                k if k == VK_F64 => {
                    if v.as_.f64v != case.expect_f64.unwrap() {
                        fail(&format!("case {i}: f64 value"));
                    }
                }
                k if k == VK_I64 => {
                    // exact integer assertion — never through f64 (review 6)
                    if v.as_.i64v != case.expect_i64.unwrap() {
                        fail(&format!(
                            "case {i}: i64 value {} != {}",
                            v.as_.i64v,
                            case.expect_i64.unwrap()
                        ));
                    }
                }
                k if k == VK_BOOL => {
                    if (v.as_.bool_value != 0) != case.expect_bool.unwrap() {
                        fail(&format!("case {i}: bool value"));
                    }
                }
                k if k == VK_STRING => {
                    let p = v.as_.string;
                    let got = std::slice::from_raw_parts(p.data, p.len);
                    if got != "h\u{e9}llo".as_bytes() {
                        fail(&format!("case {i}: string value"));
                    }
                }
                k if k == VK_BYTES => {
                    let p = v.as_.bytes;
                    let got = std::slice::from_raw_parts(p.data, p.len);
                    if got != case.expect_bytes.unwrap() {
                        fail(&format!("case {i}: bytes value"));
                    }
                }
                _ => {}
            }
            tenun_js_destroy(vm);
        }
        println!("PASS null/bool/f64/i64/string/bytes completion kinds");

        println!("== unrepresentable completions -> VALUE_BOUNDS ==");
        struct BoundsCase {
            src: &'static str,
            note: &'static str,
        }
        let bounds_cases = [
            BoundsCase {
                src: "({a: 1})",
                note: "object",
            },
            BoundsCase {
                src: "(function f(){})",
                note: "function",
            },
            BoundsCase {
                src: "'x'.repeat(70000)",
                note: "oversized string",
            },
            BoundsCase {
                src: "9223372036854775808n", // 2^63: outside int64 domain
                note: "BigInt beyond i64 range",
            },
            BoundsCase {
                src: "new ArrayBuffer(1048577)",
                note: "oversized bytes",
            },
        ];
        for case in &bounds_cases {
            let vm = tenun_js_create(&cfg);
            if vm.is_null() {
                fail("bounds vm");
            }
            eval_ok(vm, case.src); // eval succeeds…
            let mut v: ValueC = std::mem::zeroed();
            let st = tenun_js_last_result(vm, &mut v);
            if st != TENUN_JS_ERR_VALUE_BOUNDS || !last_err(vm).contains("TJERR:VALUE_BOUNDS") {
                fail(&format!("{} completion must be VALUE_BOUNDS", case.note));
            }
            tenun_js_destroy(vm);
        }
        println!("PASS object/function/oversized completions fail VALUE_BOUNDS");

        println!("== stale-diagnostic overwrite (review 7) ==");
        {
            let vm = tenun_js_create(&cfg);
            if vm.is_null() {
                fail("stale vm");
            }
            // seed a sticky diagnostic
            let bad = pack_bundle("x"); // invalid: no TJRB magic
            let _ = tenun_js_eval_bundle(vm, bad.as_ptr(), bad.len());
            if !last_err(vm).starts_with("TJERR:") {
                fail("seed diagnostic missing");
            }
            struct ArgCase {
                note: &'static str,
                run: fn(*mut TenunJsVm) -> i32,
                want_status: i32,
                want_prefix: &'static str,
            }
            fn eval_null(vm: *mut TenunJsVm) -> i32 {
                unsafe { tenun_js_eval_bundle(vm, std::ptr::null(), 10) }
            }
            fn eval_oversize(vm: *mut TenunJsVm) -> i32 {
                unsafe { tenun_js_eval_bundle(vm, [0u8; 8].as_ptr(), (usize::MAX) >> 2) }
            }
            fn reg_null_name(vm: *mut TenunJsVm) -> i32 {
                unsafe { tenun_js_register_host_fn(vm, std::ptr::null(), Some(host_a)) }
            }
            fn reg_null_fn(vm: *mut TenunJsVm) -> i32 {
                unsafe { tenun_js_register_host_fn(vm, c"x".as_ptr() as *const u8, None) }
            }
            fn reg_bad_utf8(vm: *mut TenunJsVm) -> i32 {
                unsafe { tenun_js_register_host_fn(vm, [0xFF, 0xFE, 0x00].as_ptr(), Some(host_a)) }
            }
            fn reg_empty(vm: *mut TenunJsVm) -> i32 {
                unsafe { tenun_js_register_host_fn(vm, [0u8].as_ptr(), Some(host_a)) }
            }
            fn last_res_null(vm: *mut TenunJsVm) -> i32 {
                unsafe { tenun_js_last_result(vm, std::ptr::null_mut()) }
            }
            let arg_cases = [
                ArgCase {
                    note: "null bundle",
                    run: eval_null,
                    want_status: TENUN_JS_ERR_ARGUMENT,
                    want_prefix: "TJERR:ARGUMENT",
                },
                ArgCase {
                    note: "oversize bundle",
                    run: eval_oversize,
                    want_status: TENUN_JS_ERR_ARGUMENT,
                    want_prefix: "TJERR:ARGUMENT",
                },
                ArgCase {
                    note: "null name",
                    run: reg_null_name,
                    want_status: TENUN_JS_ERR_ARGUMENT,
                    want_prefix: "TJERR:ARGUMENT",
                },
                ArgCase {
                    note: "null fn",
                    run: reg_null_fn,
                    want_status: TENUN_JS_ERR_ARGUMENT,
                    want_prefix: "TJERR:ARGUMENT",
                },
                ArgCase {
                    note: "bad utf8 name",
                    run: reg_bad_utf8,
                    want_status: TENUN_JS_ERR_ARGUMENT,
                    want_prefix: "TJERR:ARGUMENT",
                },
                ArgCase {
                    note: "empty name",
                    run: reg_empty,
                    want_status: TENUN_JS_ERR_ARGUMENT,
                    want_prefix: "TJERR:ARGUMENT",
                },
                ArgCase {
                    note: "null out",
                    run: last_res_null,
                    want_status: TENUN_JS_ERR_ARGUMENT,
                    want_prefix: "TJERR:ARGUMENT",
                },
            ];
            for case in &arg_cases {
                let st = (case.run)(vm);
                let e = last_err(vm);
                if st != case.want_status || !e.starts_with(case.want_prefix) {
                    fail(&format!(
                        "case {}: st={} err='{}' (want status {} prefix {})",
                        case.note, st, e, case.want_status, case.want_prefix
                    ));
                }
            }
            // seeded diagnostic must be GONE by now: last case replaced it
            if last_err(vm).contains("BUNDLE_MAGIC") {
                fail("seeded diagnostic survived argument failures");
            }
            tenun_js_destroy(vm);
        }
        println!("PASS every failed resolvable-VM call overwrites last_error");

        println!("== callback echoes its own argument (review 9) ==");
        {
            // the callback RETURNS one of its received arguments; the
            // payload lives in callback scratch — conversion must happen
            // before scratch release
            extern "C" fn host_echo0(
                _vm: *mut TenunJsVm,
                args: *const ValueC,
                _c: usize,
            ) -> ValueC {
                unsafe { *args }
            }
            let vm = tenun_js_create(&cfg);
            if vm.is_null() {
                fail("echo vm");
            }
            if tenun_js_register_host_fn(vm, c"echo0".as_ptr() as *const u8, Some(host_echo0))
                != TENUN_JS_OK
            {
                fail("echo registration");
            }
            // string echo
            eval_ok(
                vm,
                "var s = 'w\\u00f6rld-' + 'x'.repeat(300);\n\
                 if (echo0(s) !== s) throw new Error('string echo lost');\n1",
            );
            // bytes echo
            eval_ok(
                vm,
                "var ab = new ArrayBuffer(70000); new Uint8Array(ab).fill(7);\n\
                 var back = new Uint8Array(echo0(ab));\n\
                 if (back.length !== 70000 || back[69999] !== 7) throw new Error('bytes echo lost');\n2",
            );
            tenun_js_destroy(vm);
        }
        println!("PASS string + byte echo round-trip through callback scratch");

        println!("== MAX_ARGS enforcement (review 7/9) ==");
        {
            static NINE_ARGC: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(999);
            extern "C" fn host_nine(vm: *mut TenunJsVm, _a: *const ValueC, argc: usize) -> ValueC {
                NINE_ARGC.store(argc as u64, Ordering::SeqCst);
                // review 8: the exceedance diagnostic is CALLBACK-VISIBLE —
                // documented policy; read it from inside the callback
                let e = last_err(vm);
                if !e.contains("TJERR:VALUE_BOUNDS") || !e.contains("TENUN_JS_MAX_ARGS") {
                    fail("exceedance diagnostic not visible inside callback");
                }
                let mut out: ValueC = unsafe { std::mem::zeroed() };
                out.kind = VK_NULL;
                out
            }
            let vm = tenun_js_create(&cfg);
            if vm.is_null() {
                fail("nine vm");
            }
            if tenun_js_register_host_fn(vm, c"nine".as_ptr() as *const u8, Some(host_nine))
                != TENUN_JS_OK
            {
                fail("nine registration");
            }
            struct NineCase {
                src: &'static str,
                note: &'static str,
            }
            let nine_cases = [
                NineCase {
                    src: "nine(1,2,3,4,5,6,7,8,9); 1",
                    note: "nine valid",
                },
                NineCase {
                    src: "nine({},2,3,4,5,6,7,8,9); 1",
                    note: "unsupported object among first 8",
                },
                NineCase {
                    src: "var s9 = 'x'.repeat(70000); nine(s9,2,3,4,5,6,7,8,9); 1",
                    note: "oversized string among first 8",
                },
                NineCase {
                    src: "var b9 = new ArrayBuffer(1048577); nine(b9,2,3,4,5,6,7,8,9); 1",
                    note: "oversized bytes among first 8",
                },
            ];
            for case in &nine_cases {
                NINE_ARGC.store(999, Ordering::SeqCst);
                eval_ok(vm, case.src);
                // MAX_ARGS always visible; a dropped unsupported/oversized
                // argument additionally reduces argc below 8
                if NINE_ARGC.load(Ordering::SeqCst) > 8 {
                    fail(&format!("{}: argc must not exceed MAX_ARGS", case.note));
                }
                // post-evaluation the combined warning is cleared by success
                if !last_err(vm).is_empty() {
                    fail(&format!("{}: warning must not survive success", case.note));
                }
            }
            tenun_js_destroy(vm);
        }
        println!(
            "PASS 9-arg call delivers MAX_ARGS; combined warning visible in every over-limit case"
        );

        println!("== callback warning isolation across invocations (review 10) ==");
        {
            // two callbacks in ONE evaluation (one registered host fn,
            // invoked with 9 args then with 1 arg): the over-limit call
            // must see its MAX_ARGS warning, the following clean call must
            // NOT see it, and successful evaluation must clear everything
            static ISO_STEP: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
            extern "C" fn host_iso(vm: *mut TenunJsVm, _a: *const ValueC, argc: usize) -> ValueC {
                match ISO_STEP.load(Ordering::SeqCst) {
                    1 => {
                        if argc != 8 {
                            fail("iso: nine-arg call must marshal the first MAX_ARGS args");
                        }
                        let e = last_err(vm);
                        if !e.contains("TJERR:VALUE_BOUNDS") || !e.contains("TENUN_JS_MAX_ARGS") {
                            fail("iso: MAX_ARGS warning missing in over-limit callback");
                        }
                    }
                    2 => {
                        if argc != 1 {
                            fail("iso: clean call must see its single argument");
                        }
                        let e = last_err(vm);
                        if !e.is_empty() {
                            fail(&format!("iso: clean callback inherited stale warning: {e}"));
                        }
                    }
                    _ => fail("iso: unexpected extra callback"),
                }
                ISO_STEP.fetch_add(1, Ordering::SeqCst);
                let mut out: ValueC = unsafe { std::mem::zeroed() };
                out.kind = VK_NULL;
                out
            }
            ISO_STEP.store(1, Ordering::SeqCst);
            let vm = tenun_js_create(&cfg);
            if vm.is_null() {
                fail("iso vm");
            }
            if tenun_js_register_host_fn(vm, c"iso".as_ptr() as *const u8, Some(host_iso))
                != TENUN_JS_OK
            {
                fail("iso registration");
            }
            eval_ok(vm, "iso(1,2,3,4,5,6,7,8,9);\niso(1);\n2");
            if ISO_STEP.load(Ordering::SeqCst) != 3 {
                fail("iso: clean callback never ran");
            }
            if !last_err(vm).is_empty() {
                fail("iso: warning must not survive success");
            }
            tenun_js_destroy(vm);
        }
        println!("PASS clean callback does not inherit a previous callback's warning");

        println!("== bounded adapter storage (review 8) ==");
        {
            // (1) repeated last_result on a large completion must plateau:
            // one replaceable result buffer, not an append-only pool
            let vm = tenun_js_create(&cfg);
            if vm.is_null() {
                fail("storage vm1");
            }
            let src = "var ab = new ArrayBuffer(1048576); new Uint8Array(ab).fill(1); ab";
            eval_ok(vm, src);
            let mut v: ValueC = std::mem::zeroed();
            for _ in 0..1000 {
                let st = tenun_js_last_result(vm, &mut v);
                if st != TENUN_JS_OK || v.kind != VK_BYTES {
                    fail("storage: repeated last_result");
                }
            }
            // the replace-on-call model keeps exactly one 1 MiB result buffer
            // (plus the small completion copy); a pool model would hold 1000x
            tenun_js_destroy(vm);
            println!("PASS 1000x last_result on 1 MiB completion (replace-on-call)");
        }
        {
            // (2) repeated host calls reusing one small ArrayBuffer: scratch
            // is callback-scoped, so native storage cannot grow per call
            let vm = tenun_js_create(&cfg);
            if vm.is_null() {
                fail("storage vm2");
            }
            if tenun_js_register_host_fn(vm, c"eat".as_ptr() as *const u8, Some(host_eat))
                != TENUN_JS_OK
            {
                fail("storage registration");
            }
            eval_ok(
                vm,
                "var big = new ArrayBuffer(1048576); new Uint8Array(big).fill(2);\n\
                 for (var i = 0; i < 500; i++) { eat(big); }\n1",
            );
            tenun_js_destroy(vm);
            println!("PASS 500x host calls on 1 MiB buffer (callback-scoped scratch)");
        }
        {
            // (3) aggregate scratch budget: 100 x 1 MiB arguments in ONE call
            // exceed MAX_BUFFER_POOL_BYTES; excess args drop with VALUE_BOUNDS
            let vm = tenun_js_create(&cfg);
            if vm.is_null() {
                fail("storage vm3");
            }
            extern "C" fn host_count(
                _vm: *mut TenunJsVm,
                _a: *const ValueC,
                argc: usize,
            ) -> ValueC {
                let mut out: ValueC = unsafe { std::mem::zeroed() };
                out.kind = VK_I64;
                out.as_.i64v = argc as i64;
                out
            }
            if tenun_js_register_host_fn(vm, c"count".as_ptr() as *const u8, Some(host_count))
                != TENUN_JS_OK
            {
                fail("storage registration 3");
            }
            // MAX_ARGS=8 caps marshalled args at 8 MiB scratch, over budget ->
            // args drop; callback may see fewer than 8, completion still runs
            eval_ok(
                vm,
                "var a = new ArrayBuffer(1048576); count(a,a,a,a,a,a,a,a,a,a); 1",
            );
            tenun_js_destroy(vm);
            println!("PASS callback scratch budget enforced without unbounded growth");
        }
        {
            // (4) sustained loop: 200 host calls x 1 MiB string args, then a
            // second full evaluation — memory must return to a plateau
            let vm = tenun_js_create(&cfg);
            if vm.is_null() {
                fail("storage vm4");
            }
            if tenun_js_register_host_fn(vm, c"eat".as_ptr() as *const u8, Some(host_eat))
                != TENUN_JS_OK
            {
                fail("storage registration 4");
            }
            eval_ok(
                vm,
                "var s = 'x'.repeat(65536);\n\
                 for (var i = 0; i < 200; i++) { eat(s); }\n1",
            );
            eval_ok(vm, "2"); // fresh evaluation clears stale scratch
            tenun_js_destroy(vm);
            println!("PASS 200x max-string args + fresh evaluation (plateau)");
        }

        println!("== host I64 return: exact via BigInt (review 6) ==");
        {
            extern "C" fn ret_i64_exact(
                _vm: *mut TenunJsVm,
                _a: *const ValueC,
                _c: usize,
            ) -> ValueC {
                let mut out: ValueC = unsafe { std::mem::zeroed() };
                out.kind = VK_I64;
                out.as_.i64v = 9007199254740993; // 2^53 + 1
                out
            }
            let vm = tenun_js_create(&cfg);
            if vm.is_null() {
                fail("ret-i64 vm");
            }
            if tenun_js_register_host_fn(vm, c"retI64".as_ptr() as *const u8, Some(ret_i64_exact))
                != TENUN_JS_OK
            {
                fail("ret-i64 registration");
            }
            eval_ok(
                vm,
                "if (retI64() !== 9007199254740993n) throw new Error('i64 lossy'); 1",
            );
            tenun_js_destroy(vm);
        }
        println!("PASS host i64 returns exact BigInt to JS (2^53+1 round-trips)");

        println!("== JS BigInt arguments: exact i64 (review 6) ==");
        {
            static PREC_I64: std::sync::atomic::AtomicI64 = std::sync::atomic::AtomicI64::new(0);
            static PREC_ARGC: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(999);
            extern "C" fn host_i64(
                _vm: *mut TenunJsVm,
                args: *const ValueC,
                argc: usize,
            ) -> ValueC {
                unsafe {
                    PREC_ARGC.store(argc as u64, Ordering::SeqCst);
                    if argc > 0 && (*args).kind == VK_I64 {
                        PREC_I64.store((*args).as_.i64v, Ordering::SeqCst);
                    }
                }
                let mut out: ValueC = unsafe { std::mem::zeroed() };
                out.kind = VK_NULL;
                out
            }
            let vm = tenun_js_create(&cfg);
            if vm.is_null() {
                fail("arg-i64 vm");
            }
            if tenun_js_register_host_fn(vm, c"i64probe".as_ptr() as *const u8, Some(host_i64))
                != TENUN_JS_OK
            {
                fail("arg-i64 registration");
            }
            for (lit, want) in [
                ("9223372036854775807n", i64::MAX),
                ("-9223372036854775808n", i64::MIN),
                ("9007199254740993n", 9007199254740993),
                ("123n", 123),
            ] {
                eval_ok(vm, &format!("i64probe({lit}); 1"));
                if PREC_I64.load(Ordering::SeqCst) != want {
                    fail(&format!(
                        "BigInt arg {lit}: got {} want {want}",
                        PREC_I64.load(Ordering::SeqCst)
                    ));
                }
            }
            // out-of-range BigInt is dropped with reduced argc (same
            // documented truncation semantics as oversize strings; the
            // transient VALUE_BOUNDS diagnostic is cleared because the
            // bundle itself completes successfully)
            eval_ok(vm, "i64probe(9223372036854775808n); 2");
            if PREC_ARGC.load(Ordering::SeqCst) != 0 {
                fail("out-of-range BigInt arg must be dropped");
            }
            // and a FAILING bundle must still surface the drop diagnostic
            {
                let b = pack_bundle("throw 0; i64probe(9223372036854775808n); 3");
                let st = tenun_js_eval_bundle(vm, b.as_ptr(), b.len());
                if st != TENUN_JS_ERR_EVAL {
                    fail("throwing bundle must fail EVAL");
                }
            }
            tenun_js_destroy(vm);
        }
        println!("PASS BigInt args exact in int64 domain; beyond dropped VALUE_BOUNDS");

        tenun_js_destroy(vm_a);
        tenun_js_destroy(vm_b);
        println!("ALL PASS");
    }
}
