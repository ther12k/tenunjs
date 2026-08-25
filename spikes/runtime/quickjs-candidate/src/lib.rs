// FFI spike scope: full per-fn # Safety sections arrive with the production
// engine surface (M2+); cross-boundary rules live in the contract doc beside
// each header.
#![allow(clippy::missing_safety_doc)]

use std::cell::{Cell, RefCell};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
use std::sync::Arc;
use std::thread::ThreadId;

use rquickjs::function::{Func, Rest};
use rquickjs::{Context, Ctx, Runtime, Value};
use sha2::{Digest, Sha256};

pub const TENUN_JS_OK: i32 = 0;
pub const TENUN_JS_ERR_ABI: i32 = 1;
pub const TENUN_JS_ERR_BUNDLE_MAGIC: i32 = 2;
pub const TENUN_JS_ERR_BUNDLE_VERSION: i32 = 3;
pub const TENUN_JS_ERR_BUNDLE_LENGTH: i32 = 4;
pub const TENUN_JS_ERR_BUNDLE_DIGEST: i32 = 5;
pub const TENUN_JS_ERR_EVAL: i32 = 6;
pub const TENUN_JS_ERR_TIMEOUT: i32 = 7;
pub const TENUN_JS_ERR_VALUE_BOUNDS: i32 = 8;
pub const TENUN_JS_ERR_REGISTRATION: i32 = 9;
pub const TENUN_JS_ERR_ARGUMENT: i32 = 10;
pub const TENUN_JS_ERR_AFFINITY: i32 = 11;

const ABI_VERSION: u32 = 1;
const MAX_BUNDLE_BYTES: usize = 16 * 1024 * 1024;
const MAX_NAME_LEN: usize = 128;

#[repr(C)]
#[derive(Clone, Copy)]
pub struct ConfigC {
    pub abi_version: u32,
    pub max_heap_bytes: u64,
    pub interrupt_poll_ms: u32,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct ErrorC {
    pub message: [u8; 256],
    pub line: i32,
    pub column: i32,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct StrC {
    pub data: *const u8,
    pub len: usize,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub union ValueUnionC {
    pub f64v: f64,
    pub i64v: i64,
    pub bool_value: i32,
    pub string: StrC,
    pub bytes: StrC,
}

// kind is a raw u32 across the ABI: C callers may send any tag, so the Rust
// side range-checks instead of trusting an enum discriminant.
pub const TENUN_JS_VALUE_NULL: u32 = 0;
pub const TENUN_JS_VALUE_F64: u32 = 1;
pub const TENUN_JS_VALUE_I64: u32 = 2;
pub const TENUN_JS_VALUE_BOOL: u32 = 3;
pub const TENUN_JS_VALUE_STRING: u32 = 4;
pub const TENUN_JS_VALUE_BYTES: u32 = 5;

#[repr(C)]
pub struct ValueC {
    pub kind: u32,
    pub as_: ValueUnionC,
}

type HostFn = extern "C" fn(vm: *mut TenunJsVm, args: *const ValueC, argc: usize) -> ValueC;

struct VmState {
    interrupted: Arc<AtomicBool>,
    interrupt_flag: Arc<AtomicI32>,
    host_fn: RefCell<Option<HostFn>>,
    host_name: RefCell<String>,
    last_error: RefCell<Option<(String, i32, i32)>>,
    result_f64: Cell<f64>,
}

pub struct TenunJsVm {
    runtime: Runtime,
    context: Context,
    owner: ThreadId,
    state: VmState,
}

impl TenunJsVm {
    fn set_error(&self, msg: &str) {
        *self.state.last_error.borrow_mut() = Some((msg.to_string(), -1, -1));
    }
    fn clear_error(&self) {
        *self.state.last_error.borrow_mut() = None;
    }
}

fn validate_bundle(bytes: &[u8]) -> Result<&[u8], (&'static str, i32)> {
    if bytes.len() < 48 || &bytes[0..4] != b"TJRB" {
        return Err(("TJERR:BUNDLE_MAGIC: bad magic", TENUN_JS_ERR_BUNDLE_MAGIC));
    }
    let version = u32::from_le_bytes(bytes[4..8].try_into().unwrap());
    if version != ABI_VERSION {
        return Err((
            "TJERR:BUNDLE_VERSION: unsupported format version",
            TENUN_JS_ERR_BUNDLE_VERSION,
        ));
    }
    let payload_len = u64::from_le_bytes(bytes[8..16].try_into().unwrap()) as usize;
    if payload_len != bytes.len().saturating_sub(48) {
        return Err((
            "TJERR:BUNDLE_LENGTH: length field mismatch",
            TENUN_JS_ERR_BUNDLE_LENGTH,
        ));
    }
    let digest: [u8; 32] = bytes[16..48].try_into().unwrap();
    let mut hasher = Sha256::new();
    hasher.update(&bytes[48..]);
    if digest != hasher.finalize().as_slice() {
        return Err((
            "TJERR:BUNDLE_DIGEST: sha256 mismatch",
            TENUN_JS_ERR_BUNDLE_DIGEST,
        ));
    }
    Ok(&bytes[48..])
}

fn affinity_ok(vm: &TenunJsVm) -> bool {
    vm.owner == std::thread::current().id()
}

macro_rules! entry {
    ($vm:expr, $body:expr) => {
        catch_unwind(AssertUnwindSafe(|| {
            if $vm.is_null() {
                return TENUN_JS_ERR_ARGUMENT;
            }
            let vm_ref = unsafe { &*$vm };
            if !affinity_ok(vm_ref) {
                vm_ref.set_error("TJERR:AFFINITY: cross-thread access rejected");
                return TENUN_JS_ERR_AFFINITY;
            }
            $body(vm_ref)
        }))
        .unwrap_or(TENUN_JS_ERR_ARGUMENT)
    };
}

#[no_mangle]
pub unsafe extern "C" fn tenun_js_create(cfg: *const ConfigC) -> *mut TenunJsVm {
    catch_unwind(AssertUnwindSafe(|| {
        if cfg.is_null() {
            return std::ptr::null_mut();
        }
        let c = unsafe { &*cfg };
        if c.abi_version != ABI_VERSION {
            return std::ptr::null_mut();
        }
        let rt = match Runtime::new() {
            Ok(rt) => rt,
            Err(_) => return std::ptr::null_mut(),
        };
        if c.max_heap_bytes > 0 && c.max_heap_bytes <= u32::MAX as u64 {
            rt.set_memory_limit(c.max_heap_bytes as usize);
        }
        let interrupted = Arc::new(AtomicBool::new(false));
        let flag = Arc::new(AtomicI32::new(0));
        {
            let interrupted = interrupted.clone();
            let flag = flag.clone();
            rt.set_interrupt_handler(Some(Box::new(move || {
                if flag.load(Ordering::Acquire) != 0 {
                    interrupted.store(true, Ordering::Release);
                    true
                } else {
                    false
                }
            })));
        }
        let ctx = match Context::full(&rt) {
            Ok(c) => c,
            Err(_) => return std::ptr::null_mut(),
        };
        Box::into_raw(Box::new(TenunJsVm {
            runtime: rt,
            context: ctx,
            owner: std::thread::current().id(),
            state: VmState {
                interrupted,
                interrupt_flag: flag,
                host_fn: RefCell::new(None),
                host_name: RefCell::new(String::new()),
                last_error: RefCell::new(None),
                result_f64: Cell::new(f64::NAN),
            },
        }))
    }))
    .unwrap_or(std::ptr::null_mut())
}

#[no_mangle]
pub unsafe extern "C" fn tenun_js_destroy(vm: *mut TenunJsVm) {
    catch_unwind(AssertUnwindSafe(|| {
        if !vm.is_null() {
            drop(Box::from_raw(vm));
        }
    }))
    .ok();
}

unsafe fn eval_impl(vm: &TenunJsVm, bytes: *const u8, len: usize) -> i32 {
    if bytes.is_null() || len > MAX_BUNDLE_BYTES {
        return TENUN_JS_ERR_ARGUMENT;
    }
    let slice = std::slice::from_raw_parts(bytes, len);
    let source = match validate_bundle(slice) {
        Ok(s) => s,
        Err((msg, code)) => {
            vm.set_error(msg);
            return code;
        }
    };
    let code_str = match std::str::from_utf8(source) {
        Ok(c) => c.to_string(),
        Err(_) => {
            vm.set_error("TJERR:EVAL_UTF8: bundle payload is not valid UTF-8");
            return TENUN_JS_ERR_EVAL;
        }
    };
    vm.state.interrupted.store(false, Ordering::Relaxed);
    let result: Result<Option<f64>, rquickjs::Error> = vm.context.with(|ctx| {
        ctx.eval(code_str.as_bytes())
            .map(|v: rquickjs::Value<'_>| v.as_number())
    });
    match result {
        Ok(num) => {
            vm.state.result_f64.set(num.unwrap_or(f64::NAN));
            vm.clear_error();
            TENUN_JS_OK
        }
        Err(err) => {
            if vm.state.interrupted.load(Ordering::Acquire) {
                vm.set_error("TJERR:TIMEOUT: evaluation was interrupted");
                TENUN_JS_ERR_TIMEOUT
            } else {
                let msg = match err {
                    rquickjs::Error::Exception => vm.context.with(|ctx| {
                        format!(
                            "TJERR:EVAL_EXCEPTION: {}",
                            ctx.catch()
                                .as_string()
                                .and_then(|s| s.to_string().ok())
                                .unwrap_or_else(|| "exception".to_string())
                        )
                    }),
                    other => format!("TJERR:EVAL: {other}"),
                };
                vm.set_error(&msg);
                TENUN_JS_ERR_EVAL
            }
        }
    }
}

#[no_mangle]
pub unsafe extern "C" fn tenun_js_eval_bundle(
    vm: *mut TenunJsVm,
    bytes: *const u8,
    len: usize,
) -> i32 {
    entry!(vm, |vm: &TenunJsVm| eval_impl(vm, bytes, len))
}

#[no_mangle]
pub unsafe extern "C" fn tenun_js_register_host_fn(
    vm: *mut TenunJsVm,
    name: *const u8,
    fn_ptr: Option<HostFn>,
) -> i32 {
    entry!(vm, |vm: &TenunJsVm| register_impl(vm, name, fn_ptr))
}

unsafe fn register_impl(vm: &TenunJsVm, name: *const u8, fn_ptr: Option<HostFn>) -> i32 {
    if name.is_null() {
        return TENUN_JS_ERR_ARGUMENT;
    }
    let Some(stored_fn) = fn_ptr else {
        return TENUN_JS_ERR_ARGUMENT;
    };
    if vm.state.host_fn.borrow().is_some() {
        return TENUN_JS_ERR_REGISTRATION;
    }
    let mut fname_len = None;
    for i in 0..=MAX_NAME_LEN {
        if *name.add(i) == 0 {
            fname_len = Some(i);
            break;
        }
    }
    let fname = match fname_len.map(|l| std::slice::from_raw_parts(name, l)) {
        Some(sl) => match std::str::from_utf8(sl) {
            Ok(f) => f.to_string(),
            Err(_) => return TENUN_JS_ERR_ARGUMENT,
        },
        None => return TENUN_JS_ERR_VALUE_BOUNDS,
    };
    if fname.is_empty() {
        return TENUN_JS_ERR_ARGUMENT;
    }

    // Bind THIS VM + THIS function pointer into a Copy-capturing closure:
    // no thread-local singletons, no cross-VM leakage. The closure is `Fn`
    // because every capture is copied by value.
    let vm_ptr = vm as *const TenunJsVm as *mut TenunJsVm;
    let res: rquickjs::Result<()> = vm.context.with(|ctx| {
        ctx.globals().set(
            fname.as_str(),
            Func::from(move |ctx, _args: Rest<Value>| {
                let converted: [ValueC; 0] = [];
                let out = stored_fn(vm_ptr, converted.as_ptr(), converted.len());
                value_c_to_js(ctx, out)
            }),
        )?;
        Ok(())
    });
    if res.is_err() {
        return TENUN_JS_ERR_REGISTRATION;
    }
    *vm.state.host_fn.borrow_mut() = Some(stored_fn);
    *vm.state.host_name.borrow_mut() = fname;
    vm.clear_error();
    TENUN_JS_OK
}

fn value_c_to_js(ctx: Ctx, out: ValueC) -> rquickjs::Value {
    unsafe {
        match out.kind {
            TENUN_JS_VALUE_BOOL => rquickjs::Value::new_bool(ctx.clone(), out.as_.bool_value != 0),
            TENUN_JS_VALUE_F64 => rquickjs::Value::new_float(ctx.clone(), out.as_.f64v),
            TENUN_JS_VALUE_I64 => match i32::try_from(out.as_.i64v) {
                Ok(i) => rquickjs::Value::new_int(ctx.clone(), i),
                Err(_) => rquickjs::Value::new_float(ctx.clone(), out.as_.i64v as f64),
            },
            _ => rquickjs::Value::new_null(ctx),
        }
    }
}
#[no_mangle]
pub unsafe extern "C" fn tenun_js_pump(vm: *mut TenunJsVm, max_jobs: i64) -> i64 {
    catch_unwind(AssertUnwindSafe(|| {
        if vm.is_null() || max_jobs < 0 {
            return 0;
        }
        let vm = &*vm;
        if !affinity_ok(vm) {
            return 0;
        }
        let mut drained = 0i64;
        while drained < max_jobs {
            match vm.runtime.execute_pending_job() {
                Ok(true) => drained += 1,
                _ => break,
            }
        }
        drained
    }))
    .unwrap_or(0)
}

#[no_mangle]
pub unsafe extern "C" fn tenun_js_request_interrupt(vm: *mut TenunJsVm) -> i32 {
    // ANY thread may request interruption — deliberately no affinity check.
    catch_unwind(AssertUnwindSafe(|| {
        if vm.is_null() {
            return TENUN_JS_ERR_ARGUMENT;
        }
        let vm = &*vm;
        vm.state.interrupt_flag.store(1, Ordering::Release);
        TENUN_JS_OK
    }))
    .unwrap_or(TENUN_JS_ERR_ARGUMENT)
}

#[no_mangle]
pub unsafe extern "C" fn tenun_js_clear_interrupt(vm: *mut TenunJsVm) -> i32 {
    entry!(vm, |vm: &TenunJsVm| {
        vm.state.interrupt_flag.store(0, Ordering::Release);
        vm.state.interrupted.store(false, Ordering::Release);
        TENUN_JS_OK
    })
}

#[no_mangle]
pub unsafe extern "C" fn tenun_js_last_result(vm: *mut TenunJsVm, out: *mut ValueC) -> i32 {
    catch_unwind(AssertUnwindSafe(|| {
        if vm.is_null() || out.is_null() {
            return TENUN_JS_ERR_VALUE_BOUNDS;
        }
        let vm = &*vm;
        let v = vm.state.result_f64.get();
        if v.is_nan() {
            (*out).kind = TENUN_JS_VALUE_NULL;
        } else {
            (*out).kind = TENUN_JS_VALUE_F64;
            (*out).as_.f64v = v;
        }
        TENUN_JS_OK
    }))
    .unwrap_or(TENUN_JS_ERR_VALUE_BOUNDS)
}

#[no_mangle]
pub unsafe extern "C" fn tenun_js_last_error(vm: *mut TenunJsVm) -> ErrorC {
    let fallback = ErrorC {
        message: [0u8; 256],
        line: -1,
        column: -1,
    };
    if vm.is_null() {
        return fallback;
    }
    let vm = &*vm;
    let mut err = fallback;
    if let Some((msg, line, col)) = &*vm.state.last_error.borrow() {
        let bytes = msg.as_bytes();
        let n = bytes.len().min(255);
        err.message[..n].copy_from_slice(&bytes[..n]);
        err.line = *line;
        err.column = *col;
    }
    err
}
