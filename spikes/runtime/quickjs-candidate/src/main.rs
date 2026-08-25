use sha2::{Digest, Sha256};
use std::sync::atomic::{AtomicI64, Ordering};
use tenun_js_quickjs::*;

static CALLS_A: AtomicI64 = AtomicI64::new(0);
static CALLS_B: AtomicI64 = AtomicI64::new(0);

extern "C" fn host_a(_vm: *mut TenunJsVm, _args: *const ValueC, _argc: usize) -> ValueC {
    CALLS_A.fetch_add(1, Ordering::SeqCst);
    f64_value(11.0)
}

extern "C" fn host_b(_vm: *mut TenunJsVm, _args: *const ValueC, _argc: usize) -> ValueC {
    CALLS_B.fetch_add(1, Ordering::SeqCst);
    f64_value(22.0)
}

extern "C" fn host_bool_true(_vm: *mut TenunJsVm, _a: *const ValueC, _c: usize) -> ValueC {
    bool_value(true)
}

fn f64_value(v: f64) -> ValueC {
    let mut out: ValueC = unsafe { std::mem::zeroed() };
    out.kind = TENUN_JS_VALUE_F64;
    out.as_.f64v = v;
    out
}

fn bool_value(b: bool) -> ValueC {
    let mut out: ValueC = unsafe { std::mem::zeroed() };
    out.kind = TENUN_JS_VALUE_BOOL;
    out.as_.bool_value = b as i32;
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

fn eval_ok(vm: *mut TenunJsVm, src: &str) {
    let b = pack_bundle(src);
    let st = unsafe { tenun_js_eval_bundle(vm, b.as_ptr(), b.len()) };
    if st != TENUN_JS_OK {
        let err = unsafe { tenun_js_last_error(vm) };
        let msg = String::from_utf8_lossy(&err.message).to_string();
        fail(&format!("eval '{src}' status={st} err={msg}"));
    }
}

fn last_result(vm: *mut TenunJsVm) -> Option<f64> {
    let mut v: ValueC = unsafe { std::mem::zeroed() };
    unsafe { tenun_js_last_result(vm, &mut v) };
    if v.kind == TENUN_JS_VALUE_F64 {
        Some(unsafe { v.as_.f64v })
    } else {
        None
    }
}

fn main() {
    unsafe {
        println!("== create / abi rejection ==");
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
        if !tenun_js_create(&bad_cfg).is_null() {
            fail("wrong ABI version must yield null VM");
        }
        let vm_a = tenun_js_create(&cfg);
        let vm_b = tenun_js_create(&cfg);
        if vm_a.is_null() || vm_b.is_null() {
            fail("vm creation");
        }

        println!("== two-VM callback isolation (review regression) ==");
        if tenun_js_register_host_fn(vm_a, c"onFirstFrame".as_ptr() as *const u8, Some(host_a)) != TENUN_JS_OK
            || tenun_js_register_host_fn(vm_b, c"onFirstFrame".as_ptr() as *const u8, Some(host_b))
                != TENUN_JS_OK
        {
            fail("registrations");
        }
        
        for round in 0..2 {
            eval_ok(vm_a, "onFirstFrame(); 11");
            if last_result(vm_a) != Some(11.0) {
                fail(&format!("round{round}: VM A did not return 11"));
            }
            eval_ok(vm_b, "onFirstFrame(); 22");
            if last_result(vm_b) != Some(22.0) {
                fail(&format!("round{round}: VM B did not return 22"));
            }
        }
        if CALLS_A.load(Ordering::SeqCst) != 2 || CALLS_B.load(Ordering::SeqCst) != 2 {
            fail("callback counters show cross-VM leakage");
        }
        println!("PASS A→11 B→22 interleaved, no leakage");

        println!("== exact diagnostics + clear-on-success ==");
        // success first so a stale error would be visible
        eval_ok(vm_a, "1");
        let mut bad = pack_bundle("ok");
        bad[20] ^= 0xFF; // corrupt digest
        let st = tenun_js_eval_bundle(vm_a, bad.as_ptr(), bad.len());
        let err = tenun_js_last_error(vm_a);
        let msg = String::from_utf8_lossy(&err.message).to_string();
        if st != TENUN_JS_ERR_BUNDLE_DIGEST || !msg.starts_with("TJERR:BUNDLE_DIGEST") {
            fail(&format!("digest failure: st={st} msg='{msg}'"));
        }
        println!("PASS TJERR:BUNDLE_DIGEST reported verbatim");
        eval_ok(vm_a, "2");
        let err = tenun_js_last_error(vm_a);
        if err.message[0] != 0 {
            fail("success must clear last_error (clear-on-success policy)");
        }
        println!("PASS last_error cleared on success");

        println!("== cross-thread request allowed, clear is owner-only ==");
        let vm_addr = vm_b as usize;
        let watchdog = std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(120));
            let r = tenun_js_request_interrupt(vm_addr as *mut TenunJsVm);
            (r, vm_addr)
        });
        let stall = pack_bundle("var x = 0;\nwhile (true) { x = x + 1; }\n");
        let t0 = std::time::Instant::now();
        let st = tenun_js_eval_bundle(vm_b, stall.as_ptr(), stall.len());
        let elapsed = t0.elapsed();
        let (req_status, waddr) = watchdog.join().unwrap();
        if req_status != TENUN_JS_OK || st != TENUN_JS_ERR_TIMEOUT || elapsed.as_millis() < 100 {
            fail(&format!(
                "interrupt: req={req_status} st={st} t={elapsed:?}"
            ));
        }
        println!("PASS cross-thread request_interrupt → TIMEOUT in {elapsed:?}");
        // recovery requires owner-thread clear; wrong-thread clear fails closed
        let other_clear =
            std::thread::spawn(move || tenun_js_clear_interrupt(waddr as *mut TenunJsVm))
                .join()
                .unwrap();
        if other_clear != TENUN_JS_ERR_AFFINITY {
            fail(&format!(
                "cross-thread clear must be AFFINITY, got {other_clear}"
            ));
        }
        if tenun_js_clear_interrupt(vm_b) != TENUN_JS_OK {
            fail("owner clear_interrupt failed");
        }
        eval_ok(vm_b, "3");
        println!("PASS VM recovered after owner clear");

        println!("== affinity: non-owner eval rejected ==");
        let a_addr = vm_a as usize;
        let st = std::thread::spawn(move || {
            let b = pack_bundle("1");
            tenun_js_eval_bundle(a_addr as *mut TenunJsVm, b.as_ptr(), b.len())
        })
        .join()
        .unwrap();
        if st != TENUN_JS_ERR_AFFINITY {
            fail(&format!("non-owner eval must be AFFINITY, got {st}"));
        }
        println!("PASS ERR_AFFINITY on cross-thread eval");

        println!("== duplicate registration rejected ==");
        if tenun_js_register_host_fn(vm_a, c"onFirstFrame".as_ptr() as *const u8, Some(host_a))
            != TENUN_JS_ERR_REGISTRATION
        {
            fail("duplicate registration");
        }
        println!("PASS ERR_REGISTRATION");

        println!("== null/oversized arguments fail closed ==");
        let bundle = pack_bundle("1");
        if tenun_js_eval_bundle(std::ptr::null_mut(), bundle.as_ptr(), bundle.len())
            != TENUN_JS_ERR_ARGUMENT
            || tenun_js_eval_bundle(vm_a, std::ptr::null(), bundle.len()) != TENUN_JS_ERR_ARGUMENT
            || tenun_js_eval_bundle(vm_a, bundle.as_ptr(), usize::MAX) != TENUN_JS_ERR_ARGUMENT
        {
            fail("argument validation");
        }
        println!("PASS null/oversized rejected");

        println!("== microtask pump + bool return kind ==");
        if tenun_js_register_host_fn(vm_b, c"isReady".as_ptr() as *const u8, Some(host_bool_true))
            == TENUN_JS_OK
        {
            fail("second registration must stay rejected");
        }
        eval_ok(
            vm_b,
            "var order = [];\nPromise.resolve().then(function(){order.push(1);});\n",
        );
        let drained = tenun_js_pump(vm_b, 16);
        if drained < 1 {
            fail("pump drained nothing");
        }
        println!("PASS pumped {drained} job(s)");

        tenun_js_destroy(vm_a);
        tenun_js_destroy(vm_b);
        tenun_js_destroy(std::ptr::null_mut());
        println!("ALL PASS");
    }
}
