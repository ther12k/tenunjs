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
    (v.kind == VK_F64).then_some(unsafe { v.as_.f64v })
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
            interrupt_poll_ms: 1,
        };
        let bad_cfg = ConfigC {
            abi_version: 99,
            max_heap_bytes: 0,
            interrupt_poll_ms: 1,
        };

        println!("== create / abi rejection ==");
        if !tenun_js_create(&bad_cfg).is_null() {
            fail("wrong ABI version accepted");
        }
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
        let want = [
            VK_I64 as u64,
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
        if LAST_I64.load(Ordering::SeqCst) != 42 {
            fail("i64 arg value wrong");
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
        println!("PASS i64/f64/bool/null/string(utf8)/bytes received intact");

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

        tenun_js_destroy(vm_a);
        tenun_js_destroy(vm_b);
        println!("ALL PASS");
    }
}
