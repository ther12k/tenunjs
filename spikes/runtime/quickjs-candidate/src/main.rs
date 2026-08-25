use sha2::{Digest, Sha256};
use tenun_js_quickjs::*;

fn pack_bundle(source: &str) -> Vec<u8> {
    let payload = source.as_bytes();
    let mut out = Vec::with_capacity(48 + payload.len());
    out.extend_from_slice(b"TJRB");
    out.extend_from_slice(&1u32.to_le_bytes());
    out.extend_from_slice(&(payload.len() as u64).to_le_bytes());
    let digest: [u8; 32] = Sha256::digest(payload).into();
    out.extend_from_slice(&digest);
    out.extend_from_slice(payload);
    out
}

fn main() {
    let cfg = ConfigC {
        abi_version: 1,
        max_heap_bytes: 64 * 1024 * 1024,
        interrupt_poll_ms: 1,
    };

    unsafe {
        println!("== fixture: hello.js ==");
        let vm = tenun_js_create(&cfg);
        assert!(!vm.is_null(), "vm create failed");
        let bundle = pack_bundle("function run() { return 42; }\nrun();\n");
        let st = tenun_js_eval_bundle(vm, bundle.as_ptr(), bundle.len());
        let mut val = std::mem::zeroed::<ValueC>();
        tenun_js_last_result(vm, &mut val);
        if st == TENUN_JS_OK && matches!(val.kind, ValueKindC::F64) && unsafe { val.as_.f64v } == 42.0 {
            println!("PASS eval returns f64 completion value");
        } else {
            println!("FAIL hello.js status={st} kind={:?} ", matches!(val.kind, ValueKindC::F64));
            std::process::exit(1);
        }

        println!("== negative: corrupt digest ==");
        let mut bad = bundle.clone();
        bad[20] ^= 0xFF;
        let st = tenun_js_eval_bundle(vm, bad.as_ptr(), bad.len());
        if st == TENUN_JS_ERR_BUNDLE_DIGEST {
            println!("PASS corrupted bundle rejected with BUNDLE_DIGEST");
        } else {
            println!("FAIL expected BUNDLE_DIGEST got {st}");
            std::process::exit(1);
        }

        println!("== fixture: callback.js ==");
        let name = b"onFirstFrame";
        let st = tenun_js_register_host_fn(vm, name.as_ptr(), name.len());
        let cb =
            pack_bundle(std::str::from_utf8(include_bytes!("../../fixtures/callback.js")).unwrap());
        let st2 = tenun_js_eval_bundle(vm, cb.as_ptr(), cb.len());
        if st == TENUN_JS_OK && st2 == TENUN_JS_OK && tenun_js_host_was_called(vm) == 1 {
            println!("PASS host function invoked from JS");
        } else {
            println!(
                "FAIL callback registration={st} eval={st2} called={}",
                tenun_js_host_was_called(vm)
            );
            std::process::exit(1);
        }

        println!("== fixture: stall.js ==");
        let deadline = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_millis() as i64 + 150;
        tenun_js_set_deadline_ms(vm, deadline);
        let t0 = std::time::Instant::now();
        let stall =
            pack_bundle(std::str::from_utf8(include_bytes!("../../fixtures/stall.js")).unwrap());
        let st = tenun_js_eval_bundle(vm, stall.as_ptr(), stall.len());
        let elapsed = t0.elapsed();
        if st == TENUN_JS_ERR_TIMEOUT && elapsed < std::time::Duration::from_secs(5) {
            println!("PASS infinite loop interrupted with TIMEOUT after {elapsed:?}");
        } else {
            println!("FAIL stall status={st} elapsed={elapsed:?}");
            std::process::exit(1);
        }

        println!("== VM survives timeout ==");
        tenun_js_set_deadline_ms(vm, 0);
        let again = pack_bundle("1 + 1");
        let st = tenun_js_eval_bundle(vm, again.as_ptr(), again.len());
        let mut val = std::mem::zeroed::<ValueC>();
        tenun_js_last_result(vm, &mut val);
        if st == TENUN_JS_OK && matches!(val.kind, ValueKindC::F64) && unsafe { val.as_.f64v } == 2.0 {
            println!("PASS vm reusable after deadline fault");
        } else {
            println!("FAIL post-timeout status={st}");
            std::process::exit(1);
        }

        println!("== microtask pump ==");
        let pump_src = pack_bundle(
            "var order = [];\nPromise.resolve().then(function () { order.push(1); });\norder.push(0);\n",
        );
        let st = tenun_js_eval_bundle(vm, pump_src.as_ptr(), pump_src.len());
        let drained = tenun_js_pump(vm, 16);
        if st == TENUN_JS_OK && drained >= 1 {
            println!("PASS pumped {drained} pending job(s)");
        } else {
            println!("FAIL pump status={st} drained={drained}");
            std::process::exit(1);
        }

        tenun_js_destroy(vm);
        println!("ALL PASS");
    }
}
