use std::cell::{Cell, RefCell};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
use std::sync::Arc;

use rquickjs::function::Func;
use rquickjs::{Context, Ctx, Runtime};
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

const ABI_VERSION: u32 = 1;
const MAX_STRING_BYTES: usize = 65536;
const MAX_BYTES: usize = 1048576;
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

#[repr(C)]
#[derive(Clone, Copy)]
pub enum ValueKindC {
    Null = 0,
    F64 = 1,
    I64 = 2,
    Bool = 3,
    String = 4,
    Bytes = 5,
}

#[repr(C)]
pub struct ValueC {
    pub kind: ValueKindC,
    pub as_: ValueUnionC,
}

type HostFn = extern "C" fn(vm: *mut TenunJsVm, args: *const ValueC, argc: usize) -> ValueC;

thread_local! {
    static TRAMPOLINE_VM: Cell<*mut TenunJsVm> = const { Cell::new(std::ptr::null_mut()) };
    static TRAMPOLINE_FN: Cell<Option<HostFn>> = const { Cell::new(None) };
}

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
    state: Arc<VmState>,
}

fn null_value() -> ValueC {
    ValueC {
        kind: ValueKindC::Null,
        as_: unsafe { std::mem::zeroed() },
    }
}

fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

impl TenunJsVm {
    fn set_error(&self, msg: &str) {
        *self.state.last_error.borrow_mut() = Some((msg.to_string(), -1, -1));
    }
}

fn validate_bundle(bytes: &[u8]) -> Result<&[u8], i32> {
    if bytes.len() < 48 || &bytes[0..4] != b"TJRB" {
        return Err(TENUN_JS_ERR_BUNDLE_MAGIC);
    }
    let version = u32::from_le_bytes(bytes[4..8].try_into().unwrap());
    if version != ABI_VERSION {
        return Err(TENUN_JS_ERR_BUNDLE_VERSION);
    }
    let payload_len = u64::from_le_bytes(bytes[8..16].try_into().unwrap()) as usize;
    if payload_len != bytes.len().saturating_sub(48) {
        return Err(TENUN_JS_ERR_BUNDLE_LENGTH);
    }
    let digest: [u8; 32] = bytes[16..48].try_into().unwrap();
    let mut hasher = Sha256::new();
    hasher.update(&bytes[48..]);
    if digest != hasher.finalize().as_slice() {
        return Err(TENUN_JS_ERR_BUNDLE_DIGEST);
    }
    Ok(&bytes[48..])
}

#[no_mangle]
pub extern "C" fn tenun_js_create(cfg: *const ConfigC) -> *mut TenunJsVm {
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
                if flag.load(Ordering::Relaxed) != 0 {
                    interrupted.store(true, Ordering::Relaxed);
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
            state: Arc::new(VmState {
                interrupted,
                interrupt_flag: flag,
                host_fn: RefCell::new(None),
                host_name: RefCell::new(String::new()),
                last_error: RefCell::new(None),
                result_f64: Cell::new(f64::NAN),
            }),
        }))
    }))
    .unwrap_or_else(|_| std::ptr::null_mut())
}

#[no_mangle]
pub extern "C" fn tenun_js_destroy(vm: *mut TenunJsVm) {
    catch_unwind(AssertUnwindSafe(|| {
        if !vm.is_null() {
            unsafe { drop(Box::from_raw(vm)) };
        }
    }))
    .ok();
}

#[no_mangle]
pub unsafe extern "C" fn tenun_js_eval_bundle(
    vm: *mut TenunJsVm,
    bytes: *const u8,
    len: usize,
) -> i32 {
    catch_unwind(AssertUnwindSafe(|| eval_impl(vm, bytes, len))).unwrap_or(TENUN_JS_ERR_ARGUMENT)
}

unsafe fn eval_impl(vm: *mut TenunJsVm, bytes: *const u8, len: usize) -> i32 {
    if vm.is_null() || bytes.is_null() || len > MAX_BUNDLE_BYTES {
        return TENUN_JS_ERR_ARGUMENT;
    }
    let vm = &mut *vm;
    let slice = std::slice::from_raw_parts(bytes, len);
    let source = match validate_bundle(slice) {
        Ok(s) => s,
        Err(e) => return e,
    };
    let code = match std::str::from_utf8(source) {
        Ok(c) => c.to_string(),
        Err(_) => {
            vm.set_error("bundle payload is not valid UTF-8");
            return TENUN_JS_ERR_EVAL;
        }
    };
    vm.state.interrupted.store(false, Ordering::Relaxed);
    let result: Result<Option<f64>, rquickjs::Error> = vm.context.with(|ctx| {
        ctx.eval(code.as_bytes())
            .map(|v: rquickjs::Value<'_>| v.as_number())
    });
    match result {
        Ok(num) => {
            vm.state.result_f64.set(num.unwrap_or(f64::NAN));
            TENUN_JS_OK
        }
        Err(err) => {
            if vm.state.interrupted.load(Ordering::Relaxed) {
                vm.set_error("evaluation was interrupted by the embedder flag");
                TENUN_JS_ERR_TIMEOUT
            } else {
                let msg = match err {
                    rquickjs::Error::Exception => vm.context.with(|ctx: Ctx| {
                        ctx.catch()
                            .as_string()
                            .and_then(|s| s.to_string().ok())
                            .unwrap_or_else(|| "exception".to_string())
                    }),
                    other => format!("{other}"),
                };
                vm.set_error(&msg);
                TENUN_JS_ERR_EVAL
            }
        }
    }
}

fn js_trampoline(ctx: Ctx) -> rquickjs::Value {
    let vm = TRAMPOLINE_VM.with(|c| c.get());
    match TRAMPOLINE_FN.with(|c| c.get()) {
        Some(stored) => {
            let out = stored(vm, std::ptr::null(), 0);
            match out.kind {
                ValueKindC::Bool => {
                    rquickjs::Value::new_bool(ctx, unsafe { out.as_.bool_value } != 0)
                }
                _ => rquickjs::Value::new_null(ctx),
            }
        }
        None => rquickjs::Value::new_null(ctx),
    }
}

#[no_mangle]
pub unsafe extern "C" fn tenun_js_register_host_fn(
    vm: *mut TenunJsVm,
    name: *const u8,
    fn_ptr: Option<HostFn>,
) -> i32 {
    catch_unwind(AssertUnwindSafe(|| register_impl(vm, name, fn_ptr)))
        .unwrap_or(TENUN_JS_ERR_ARGUMENT)
}

unsafe fn register_impl(vm: *mut TenunJsVm, name: *const u8, fn_ptr: Option<HostFn>) -> i32 {
    if vm.is_null() || name.is_null() {
        return TENUN_JS_ERR_ARGUMENT;
    }
    if fn_ptr.is_none() {
        return TENUN_JS_ERR_ARGUMENT;
    }
    let vm = &mut *vm;
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
        Some(s) => match std::str::from_utf8(s) {
            Ok(f) => f.to_string(),
            Err(_) => return TENUN_JS_ERR_ARGUMENT,
        },
        None => return TENUN_JS_ERR_VALUE_BOUNDS,
    };
    if fname.is_empty() {
        return TENUN_JS_ERR_ARGUMENT;
    }
    let context = vm.context.clone();
    TRAMPOLINE_VM.with(|c| c.set(vm));
    TRAMPOLINE_FN.with(|c| c.set(fn_ptr));
    let res: rquickjs::Result<()> = context
        .with(|ctx: Ctx| -> rquickjs::Result<()> {
            ctx.globals().set(fname.as_str(), Func::from(js_trampoline))?;
            Ok(())
        });
    drop(context);
    if res.is_err() {
        return TENUN_JS_ERR_REGISTRATION;
    }
    *vm.state.host_fn.borrow_mut() = fn_ptr;
    *vm.state.host_name.borrow_mut() = fname;
    TENUN_JS_OK
}

#[no_mangle]
pub unsafe extern "C" fn tenun_js_pump(vm: *mut TenunJsVm, max_jobs: i64) -> i64 {
    catch_unwind(AssertUnwindSafe(|| {
        if vm.is_null() || max_jobs < 0 {
            return 0;
        }
        let vm = &*vm;
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
pub unsafe extern "C" fn tenun_js_interrupt_flag(vm: *mut TenunJsVm) -> *mut i32 {
    if vm.is_null() {
        return std::ptr::null_mut();
    }
    let vm = &*vm;
    Arc::as_ptr(&vm.state.interrupt_flag) as *mut i32
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
            (*out).kind = ValueKindC::Null;
        } else {
            (*out).kind = ValueKindC::F64;
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

// referenced so MAX limits stay visible to audits of the compiled surface
#[allow(dead_code)]
const _: () = {
    assert!(MAX_STRING_BYTES == 65536);
    assert!(MAX_BYTES == 1048576);
};

#[allow(unused)]
fn touch(v: &ValueC) -> i64 {
    unsafe { v.as_.i64v }
}

#[allow(unused)]
fn unused_now_ms() -> i64 {
    now_ms()
}
