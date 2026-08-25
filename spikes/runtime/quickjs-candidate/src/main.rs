use sha2::{Digest, Sha256};
use std::sync::atomic::{AtomicU32, Ordering};
use tenun_js_quickjs::*;

static HOST_CALLS: AtomicU32 = AtomicU32::new(0);

extern "C" fn on_first_frame(_vm: *mut TenunJsVm, _args: *const ValueC, _argc: usize) -> ValueC {
    HOST_CALLS.fetch_add(1, Ordering::Relaxed);
    unsafe {
        let mut v: ValueC = std::mem::zeroed();
        v.kind = ValueKindC::Null;
        v
    }
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

fn main() {
    unsafe {
        println!("== create ==");
        let cfg = ConfigC {
            abi_version: 1,
            max_heap_bytes: 64 * 1024 * 1024,
            interrupt_poll_ms: 1,
        };
        let vm = tenun_js_create(&cfg);
        if vm.is_null() {
            fail("vm creation");
        }

        println!("== negative: wrong abi version rejected ==");
        let bad_cfg = ConfigC {
            abi_version: 99,
            max_heap_bytes: 0,
            interrupt_poll_ms: 1,
        };
        if !tenun_js_create(&bad_cfg).is_null() {
            fail("wrong ABI version must yield null VM");
        }

        println!("== fixture: hello.js via C-ABI surface ==");
        let bundle = pack_bundle("function run() { return 42; }\nrun();\n");
        if tenun_js_eval_bundle(vm, bundle.as_ptr(), bundle.len()) != TENUN_JS_OK {
            fail("hello eval");
        }

        println!("== negative: corrupt digest rejected ==");
        let mut bad = bundle.clone();
        bad[20] ^= 0xFF;
        let st = tenun_js_eval_bundle(vm, bad.as_ptr(), bad.len());
        if st != TENUN_JS_ERR_BUNDLE_DIGEST {
            fail(&format!("expected BUNDLE_DIGEST got {st}"));
        }
        println!("PASS corrupted bundle rejected with BUNDLE_DIGEST");

        println!("== real host callback registered through header signature ==");
        let name = b"onFirstFrame\0";
        if tenun_js_register_host_fn(vm, name.as_ptr(), Some(on_first_frame)) != TENUN_JS_OK {
            fail("host registration");
        }
        let cb_src =
            pack_bundle(std::str::from_utf8(include_bytes!("../../fixtures/callback.js")).unwrap());
        if tenun_js_eval_bundle(vm, cb_src.as_ptr(), cb_src.len()) != TENUN_JS_OK {
            fail("callback eval");
        }
        if HOST_CALLS.load(Ordering::Relaxed) == 0 {
            fail("stored host callback was never invoked");
        }
        println!(
            "PASS stored callback invoked ({} call(s))",
            HOST_CALLS.load(Ordering::Relaxed)
        );

        println!("== duplicate registration fails closed ==");
        if tenun_js_register_host_fn(vm, name.as_ptr(), Some(on_first_frame))
            != TENUN_JS_ERR_REGISTRATION
        {
            fail("duplicate registration must return ERR_REGISTRATION");
        }
        println!("PASS duplicate rejected");

        println!("== embedder-owned watchdog interrupts infinite loop ==");
        let flag = tenun_js_interrupt_flag(vm);
        if flag.is_null() {
            fail("interrupt flag");
        }
        let flag_addr = flag as usize;
        let handle = std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(150));
            unsafe {
                std::ptr::write_volatile(flag_addr as *mut i32, 1);
            }
        });
        let t0 = std::time::Instant::now();
        let stall =
            pack_bundle(std::str::from_utf8(include_bytes!("../../fixtures/stall.js")).unwrap());
        let st = tenun_js_eval_bundle(vm, stall.as_ptr(), stall.len());
        let elapsed = t0.elapsed();
        handle.join().unwrap();
        if st != TENUN_JS_ERR_TIMEOUT || elapsed >= std::time::Duration::from_secs(5) {
            fail(&format!("stall status={st} elapsed={elapsed:?}"));
        }
        println!("PASS interrupted with TIMEOUT after {elapsed:?}");

        println!("== VM usable after fault once flag cleared ==");
        *flag = 0;
        let again = pack_bundle("1 + 1");
        if tenun_js_eval_bundle(vm, again.as_ptr(), again.len()) != TENUN_JS_OK {
            fail("post-timeout eval");
        }
        println!("PASS vm reusable after deadline fault");

        println!("== microtask pump ==");
        let pump_src = pack_bundle(
            "var order = [];\nPromise.resolve().then(function () { order.push(1); });\norder.push(0);\n",
        );
        if tenun_js_eval_bundle(vm, pump_src.as_ptr(), pump_src.len()) != TENUN_JS_OK {
            fail("pump source eval");
        }
        let drained = tenun_js_pump(vm, 16);
        if drained < 1 {
            fail("pump drained nothing");
        }
        println!("PASS pumped {drained} pending job(s)");

        println!("== null-pointer arguments fail closed ==");
        if tenun_js_eval_bundle(std::ptr::null_mut(), bundle.as_ptr(), bundle.len())
            != TENUN_JS_ERR_ARGUMENT
        {
            fail("null vm must yield ERR_ARGUMENT");
        }
        if tenun_js_eval_bundle(vm, std::ptr::null(), bundle.len()) != TENUN_JS_ERR_ARGUMENT {
            fail("null bytes must yield ERR_ARGUMENT");
        }
        if tenun_js_eval_bundle(vm, bundle.as_ptr(), usize::MAX) != TENUN_JS_ERR_ARGUMENT {
            fail("oversized len must yield ERR_ARGUMENT");
        }
        println!("PASS null/oversized arguments rejected");

        tenun_js_destroy(vm);
        tenun_js_destroy(std::ptr::null_mut());
        println!("ALL PASS");
    }
}
