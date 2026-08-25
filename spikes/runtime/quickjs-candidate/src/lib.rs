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
use rquickjs::{ArrayBuffer, Context, Ctx, Runtime, Value};
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
const MAX_STRING_BYTES: usize = 65536;
const MAX_BYTES: usize = 1048576;
const MAX_BUNDLE_BYTES: usize = 16 * 1024 * 1024;
const MAX_NAME_LEN: usize = 128;
const MAX_ARGS: usize = 8;

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

// kind crosses the ABI as a raw u32: foreign tags are range-checked before
// the union is ever read (never trusted as a Rust enum discriminant).
pub const VK_NULL: u32 = 0;
pub const VK_F64: u32 = 1;
pub const VK_I64: u32 = 2;
pub const VK_BOOL: u32 = 3;
pub const VK_STRING: u32 = 4;
pub const VK_BYTES: u32 = 5;

#[repr(C)]
#[derive(Clone, Copy)]
pub struct ValueC {
    pub kind: u32,
    pub as_: ValueUnionC,
}

type HostFn = extern "C" fn(vm: *mut TenunJsVm, args: *const ValueC, argc: usize) -> ValueC;

struct VmState {
    interrupted: Arc<AtomicBool>,
    flag: Arc<AtomicI32>,
    owner: ThreadId,
    host_fn: RefCell<Option<HostFn>>,
    /// adapter-owned storage backing string/byte values handed across the ABI;
    /// valid until the next adapter call on this VM
    buffers: RefCell<Vec<Vec<u8>>>,
    last_error: RefCell<Option<String>>,
    result_f64: Cell<f64>,
}

pub struct TenunJsVm {
    runtime: Runtime,
    context: Context,
    state: VmState,
}

impl TenunJsVm {
    fn set_error(&self, cat: &str, msg: &str) {
        *self.state.last_error.borrow_mut() = Some(format!("TJERR:{cat}: {msg}"));
    }
    fn clear_error(&self) {
        *self.state.last_error.borrow_mut() = None;
    }
    fn store_bytes(&self, data: &[u8]) -> (*const u8, usize) {
        let mut bufs = self.state.buffers.borrow_mut();
        bufs.push(data.to_vec());
        let b = bufs.last().unwrap();
        (b.as_ptr(), b.len())
    }
    fn owner_ok(&self) -> bool {
        self.state.owner == std::thread::current().id()
    }
}

fn status_cat(status: i32) -> &'static str {
    match status {
        TENUN_JS_ERR_BUNDLE_MAGIC => "BUNDLE_MAGIC",
        TENUN_JS_ERR_BUNDLE_VERSION => "BUNDLE_VERSION",
        TENUN_JS_ERR_BUNDLE_LENGTH => "BUNDLE_LENGTH",
        TENUN_JS_ERR_BUNDLE_DIGEST => "BUNDLE_DIGEST",
        TENUN_JS_ERR_EVAL => "EVAL",
        TENUN_JS_ERR_TIMEOUT => "TIMEOUT",
        TENUN_JS_ERR_VALUE_BOUNDS => "VALUE_BOUNDS",
        TENUN_JS_ERR_REGISTRATION => "REGISTRATION",
        TENUN_JS_ERR_ARGUMENT => "ARGUMENT",
        TENUN_JS_ERR_AFFINITY => "AFFINITY",
        _ => "UNKNOWN",
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

thread_local! {
    // set on the OWNER thread immediately before each evaluation and cleared
    // afterwards; host callbacks can only fire inside that window, so the
    // stash always identifies the executing VM — never another registration
    static EVAL_VM: Cell<*mut TenunJsVm> = const { Cell::new(std::ptr::null_mut()) };
}

/// JS -> bounded value. Oversized strings/byte payloads fail with
/// VALUE_BOUNDS and the argument is dropped (reflected in reduced argc) —
/// documented truncation semantics, never silent content truncation.
fn js_to_bound(vm: &TenunJsVm, v: &Value<'_>, out: &mut ValueC) -> i32 {
    if v.is_undefined() || v.is_null() {
        out.kind = VK_NULL;
        return TENUN_JS_OK;
    }
    if let Some(b) = v.as_bool() {
        out.kind = VK_BOOL;
        out.as_.bool_value = b as i32;
        return TENUN_JS_OK;
    }
    if let Some(i) = v.as_int() {
        out.kind = VK_I64;
        out.as_.i64v = i as i64;
        return TENUN_JS_OK;
    }
    if let Some(f) = v.as_number() {
        out.kind = VK_F64;
        out.as_.f64v = f;
        return TENUN_JS_OK;
    }
    if let Some(sv) = v.as_string() {
        let text = match sv.to_string() {
            Ok(t) => t,
            Err(_) => return TENUN_JS_ERR_VALUE_BOUNDS,
        };
        if text.len() > MAX_STRING_BYTES {
            return TENUN_JS_ERR_VALUE_BOUNDS;
        }
        let (ptr, len) = vm.store_bytes(text.as_bytes());
        out.kind = VK_STRING;
        out.as_.string = StrC { data: ptr, len };
        return TENUN_JS_OK;
    }
    if let Some(obj) = v.as_object() {
        if !obj.is_array_buffer() {
            out.kind = VK_NULL;
            return TENUN_JS_OK;
        }
        let ab = match obj.as_array_buffer() {
            Some(ab) => ab,
            None => return TENUN_JS_ERR_VALUE_BOUNDS,
        };
        let raw = match ab.as_bytes() {
            Some(b) => b,
            None => return TENUN_JS_ERR_VALUE_BOUNDS,
        };
        if raw.len() > MAX_BYTES {
            return TENUN_JS_ERR_VALUE_BOUNDS;
        }
        let (ptr, len) = vm.store_bytes(raw);
        out.kind = VK_BYTES;
        out.as_.bytes = StrC { data: ptr, len };
        return TENUN_JS_OK;
    }
    // unsupported shapes coerce to null deterministically
    out.kind = VK_NULL;
    TENUN_JS_OK
}

/// bounded value -> JS. Foreign tags are range-checked first; strings must be
/// valid UTF-8; sizes are capped; failures throw TJERR-carrying exceptions so
/// they are observable even though eval itself succeeds.
fn bound_to_js<'js>(ctx: Ctx<'js>, out: &ValueC) -> Result<Value<'js>, i32> {
    if out.kind > VK_BYTES {
        return Err(TENUN_JS_ERR_VALUE_BOUNDS); // invalid foreign tag
    }
    unsafe {
        match out.kind {
            VK_NULL => Ok(Value::new_null(ctx)),
            VK_BOOL => Ok(Value::new_bool(ctx.clone(), out.as_.bool_value != 0)),
            VK_F64 => Ok(Value::new_float(ctx.clone(), out.as_.f64v)),
            VK_I64 => match i32::try_from(out.as_.i64v) {
                Ok(i) => Ok(Value::new_int(ctx.clone(), i)),
                Err(_) => Ok(Value::new_float(ctx.clone(), out.as_.i64v as f64)),
            },
            VK_STRING => {
                let sp = out.as_.string;
                if sp.data.is_null() && sp.len > 0 {
                    return Err(TENUN_JS_ERR_VALUE_BOUNDS);
                }
                if sp.len > MAX_STRING_BYTES {
                    return Err(TENUN_JS_ERR_VALUE_BOUNDS);
                }
                let slice = if sp.data.is_null() {
                    &[][..]
                } else {
                    std::slice::from_raw_parts(sp.data, sp.len)
                };
                // UTF-8 policy: invalid byte sequences are rejected, not mangled
                let text = std::str::from_utf8(slice).map_err(|_| TENUN_JS_ERR_VALUE_BOUNDS)?;
                let js =
                    rquickjs::String::from_str(ctx.clone(), text).map_err(|_| TENUN_JS_ERR_EVAL)?;
                Ok(js.into_value())
            }
            VK_BYTES => {
                let bp = out.as_.bytes;
                if bp.data.is_null() && bp.len > 0 {
                    return Err(TENUN_JS_ERR_VALUE_BOUNDS);
                }
                if bp.len > MAX_BYTES {
                    return Err(TENUN_JS_ERR_VALUE_BOUNDS);
                }
                let slice = if bp.data.is_null() {
                    &[][..]
                } else {
                    std::slice::from_raw_parts(bp.data, bp.len)
                };
                let ab =
                    ArrayBuffer::new_copy(ctx.clone(), slice).map_err(|_| TENUN_JS_ERR_EVAL)?;
                Ok(ab.into_value())
            }
            _ => unreachable!("range-checked above"),
        }
    }
}

/// Registered as the native side of every host function. The VM identity
/// comes from the per-eval stash, so two VMs interleaved on one thread can
/// never observe each other's callbacks.
fn js_trampoline<'js>(ctx: Ctx<'js>, args: Rest<Value<'js>>) -> rquickjs::Result<Value<'js>> {
    let vmp = EVAL_VM.with(|c| c.get());
    if vmp.is_null() {
        return Ok(Value::new_null(ctx));
    }
    let vm = unsafe { &*vmp };
    let stored = match vm.state.host_fn.borrow().as_ref() {
        Some(f) => *f,
        None => return Ok(Value::new_null(ctx)),
    };
    let mut converted: [ValueC; MAX_ARGS] = unsafe { std::mem::zeroed() };
    let mut n = 0usize;
    for a in args.iter().take(MAX_ARGS) {
        if js_to_bound(vm, a, &mut converted[n]) == TENUN_JS_OK {
            n += 1;
        } else {
            vm.set_error("VALUE_BOUNDS", "argument dropped");
            // documented truncation semantics: arg dropped from the tail
        }
    }
    let out = stored(vmp, converted.as_ptr(), n);
    bound_to_js(ctx.clone(), &out).map_err(|code| {
        let msg = format!("TJERR:{}: host callback return rejected", status_cat(code));
        vm.set_error(status_cat(code), "host callback return rejected");
        rquickjs::Exception::throw_message(&ctx, &msg)
    })
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
                if flag.load(Ordering::SeqCst) != 0 {
                    interrupted.store(true, Ordering::SeqCst);
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
            state: VmState {
                interrupted,
                flag,
                owner: std::thread::current().id(),
                host_fn: RefCell::new(None),
                buffers: RefCell::new(Vec::new()),
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

unsafe fn eval_checked(vm: *mut TenunJsVm, bytes: *const u8, len: usize) -> i32 {
    if vm.is_null() || bytes.is_null() || len > MAX_BUNDLE_BYTES {
        return TENUN_JS_ERR_ARGUMENT;
    }
    let vm = &*vm;
    if !vm.owner_ok() {
        vm.set_error("AFFINITY", "VM used from non-owner thread");
        return TENUN_JS_ERR_AFFINITY;
    }
    let slice = std::slice::from_raw_parts(bytes, len);
    let source = match validate_bundle(slice) {
        Ok(s) => s,
        Err(e) => {
            vm.set_error(status_cat(e), "bundle rejected");
            return e;
        }
    };
    let code = match std::str::from_utf8(source) {
        Ok(c) => c.to_string(),
        Err(_) => {
            vm.set_error("EVAL", "bundle payload is not valid UTF-8");
            return TENUN_JS_ERR_EVAL;
        }
    };
    // buffers handed to C expire at the next adapter call
    vm.state.buffers.borrow_mut().clear();
    vm.state.interrupted.store(false, Ordering::SeqCst);
    EVAL_VM.with(|c| c.set(vm as *const TenunJsVm as *mut TenunJsVm));

    let result: Result<Option<f64>, rquickjs::Error> = vm
        .context
        .with(|ctx| ctx.eval(code.as_bytes()).map(|v: Value<'_>| v.as_number()));

    EVAL_VM.with(|c| c.set(std::ptr::null_mut()));
    match result {
        Ok(num) => {
            vm.state.result_f64.set(num.unwrap_or(f64::NAN));
            vm.clear_error();
            TENUN_JS_OK
        }
        Err(err) => {
            if vm.state.interrupted.load(Ordering::SeqCst) {
                vm.set_error("TIMEOUT", "evaluation was interrupted");
                TENUN_JS_ERR_TIMEOUT
            } else {
                let msg = match err {
                    rquickjs::Error::Exception => vm.context.with(|ctx: Ctx| {
                        let exc = ctx.catch();
                        if let Some(obj) = exc.as_object() {
                            match obj.get::<_, String>("message") {
                                Ok(m) => m,
                                Err(_) => "exception".to_string(),
                            }
                        } else if let Some(sv) = exc.as_string() {
                            sv.to_string().unwrap_or_else(|_| "exception".to_string())
                        } else {
                            "exception".to_string()
                        }
                    }),
                    other => format!("{other}"),
                };
                vm.set_error("EVAL", &msg);
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
    catch_unwind(AssertUnwindSafe(|| eval_checked(vm, bytes, len))).unwrap_or(TENUN_JS_ERR_ARGUMENT)
}

unsafe fn register_checked(vm: *mut TenunJsVm, name: *const u8, fn_ptr: Option<HostFn>) -> i32 {
    if vm.is_null() || name.is_null() || fn_ptr.is_none() {
        return TENUN_JS_ERR_ARGUMENT;
    }
    let vm = &*vm;
    if !vm.owner_ok() {
        vm.set_error("AFFINITY", "registration from non-owner thread");
        return TENUN_JS_ERR_AFFINITY;
    }
    if vm.state.host_fn.borrow().is_some() {
        vm.set_error("REGISTRATION", "host function already registered");
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
        None => {
            vm.set_error("VALUE_BOUNDS", "host fn name exceeds 128 bytes");
            return TENUN_JS_ERR_VALUE_BOUNDS;
        }
    };
    if fname.is_empty() {
        return TENUN_JS_ERR_ARGUMENT;
    }
    let res: rquickjs::Result<()> = vm.context.with(|ctx: Ctx| -> rquickjs::Result<()> {
        ctx.globals()
            .set(fname.as_str(), Func::from(js_trampoline))?;
        Ok(())
    });
    if res.is_err() {
        vm.set_error("REGISTRATION", "failed to install JS binding");
        return TENUN_JS_ERR_REGISTRATION;
    }
    *vm.state.host_fn.borrow_mut() = fn_ptr;
    vm.clear_error();
    TENUN_JS_OK
}

#[no_mangle]
pub unsafe extern "C" fn tenun_js_register_host_fn(
    vm: *mut TenunJsVm,
    name: *const u8,
    fn_ptr: Option<HostFn>,
) -> i32 {
    catch_unwind(AssertUnwindSafe(|| register_checked(vm, name, fn_ptr)))
        .unwrap_or(TENUN_JS_ERR_ARGUMENT)
}

#[no_mangle]
pub unsafe extern "C" fn tenun_js_pump(vm: *mut TenunJsVm, max_jobs: i64) -> i64 {
    catch_unwind(AssertUnwindSafe(|| {
        if vm.is_null() || max_jobs < 0 {
            return -1i64;
        }
        let vm = &*vm;
        if !vm.owner_ok() {
            return -1i64;
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
    .unwrap_or(-1)
}

#[no_mangle]
pub unsafe extern "C" fn tenun_js_request_interrupt(vm: *mut TenunJsVm) -> i32 {
    // deliberately NOT affinity-checked: watchdog threads may call freely
    catch_unwind(AssertUnwindSafe(|| {
        if vm.is_null() {
            return TENUN_JS_ERR_ARGUMENT;
        }
        let vm = &*vm;
        vm.state.flag.store(1, Ordering::SeqCst);
        TENUN_JS_OK
    }))
    .unwrap_or(TENUN_JS_ERR_ARGUMENT)
}

#[no_mangle]
pub unsafe extern "C" fn tenun_js_clear_interrupt(vm: *mut TenunJsVm) -> i32 {
    catch_unwind(AssertUnwindSafe(|| {
        if vm.is_null() {
            return TENUN_JS_ERR_ARGUMENT;
        }
        let vm = &*vm;
        if !vm.owner_ok() {
            vm.set_error("AFFINITY", "clear_interrupt from non-owner thread");
            return TENUN_JS_ERR_AFFINITY;
        }
        vm.state.flag.store(0, Ordering::SeqCst);
        vm.state.interrupted.store(false, Ordering::SeqCst);
        TENUN_JS_OK
    }))
    .unwrap_or(TENUN_JS_ERR_ARGUMENT)
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
            (*out).kind = VK_NULL;
        } else {
            (*out).kind = VK_F64;
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
    if let Some(msg) = &*vm.state.last_error.borrow() {
        let bytes = msg.as_bytes();
        let n = bytes.len().min(255);
        err.message[..n].copy_from_slice(&bytes[..n]);
    }
    err
}
