use std::cell::{Cell, RefCell};
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};

use rquickjs::function::Func;
use rquickjs::{Ctx, Context, Runtime, Value};
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

const MAX_STRING_BYTES: usize = 65536;
const MAX_BYTES: usize = 1048576;

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
pub enum ValueKindC {
    Null = 0,
    F64 = 1,
    I64 = 2,
    Bool = 3,
    String = 4,
    Bytes = 5,
}

#[repr(C)]
pub union ValueUnionC {
    pub f64v: f64,
    pub i64v: i64,
    pub boolv: i32,
    pub strv: StrView,
    pub bytesv: BytesView,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct StrView {
    pub data: *const u8,
    pub len: usize,
}

#[repr(C)]
#[derive(Clone, Copy)]
pub struct BytesView {
    pub data: *const u8,
    pub len: usize,
}

#[repr(C)]
pub struct ValueC {
    pub kind: ValueKindC,
    pub as_: ValueUnionC,
}

struct VmState {
    interrupted: Arc<AtomicBool>,
    deadline_ms: Arc<AtomicI64>,
    host_called: Arc<AtomicBool>,
    last_error: RefCell<Option<(String, i32, i32)>>,
    result_f64: Cell<f64>,
}

pub struct TenunJsVm {
    runtime: Runtime,
    context: Context,
    state: Arc<VmState>,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

unsafe impl Send for TenunJsVm {}

impl TenunJsVm {
    fn set_error(&self, msg: &str) {
        let mut buf = [0u8; 256];
        let bytes = msg.as_bytes();
        let n = bytes.len().min(255);
        buf[..n].copy_from_slice(&bytes[..n]);
        *self.state.last_error.borrow_mut() = Some((msg.to_string(), -1, -1));
        let _ = buf;
    }
}

#[no_mangle]
pub extern "C" fn tenun_js_create(cfg: *const ConfigC) -> *mut TenunJsVm {
    if cfg.is_null() {
        return std::ptr::null_mut();
    }
    let c = unsafe { &*cfg };
    if c.abi_version != 1 {
        return std::ptr::null_mut();
    }
    let rt = match Runtime::new() {
        Ok(rt) => rt,
        Err(_) => return std::ptr::null_mut(),
    };
    if c.max_heap_bytes > 0 {
        rt.set_memory_limit(c.max_heap_bytes as usize);
    }
    let interrupted = Arc::new(AtomicBool::new(false));
    let deadline = Arc::new(AtomicI64::new(0));
    {
        let interrupted = interrupted.clone();
        let deadline = deadline.clone();
        rt.set_interrupt_handler(Some(Box::new(move || {
            let dl = deadline.load(Ordering::Relaxed);
            if dl > 0 && now_ms() > dl {
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
    let state = Arc::new(VmState {
        interrupted,
        deadline_ms: deadline,
        host_called: Arc::new(AtomicBool::new(false)),
        last_error: RefCell::new(None),
        result_f64: Cell::new(f64::NAN),
    });
    let vm = Box::new(TenunJsVm {
        runtime: rt,
        context: ctx,
        state,
    });
    Box::into_raw(vm)
}

#[no_mangle]
pub unsafe extern "C" fn tenun_js_destroy(vm: *mut TenunJsVm) {
    if !vm.is_null() {
        drop(Box::from_raw(vm));
    }
}

fn validate_bundle(bytes: &[u8]) -> Result<&[u8], i32> {
    if bytes.len() < 48 || &bytes[0..4] != b"TJRB" {
        return Err(TENUN_JS_ERR_BUNDLE_MAGIC);
    }
    let version = u32::from_le_bytes(bytes[4..8].try_into().unwrap());
    if version != 1 {
        return Err(TENUN_JS_ERR_BUNDLE_VERSION);
    }
    let payload_len = u64::from_le_bytes(bytes[8..16].try_into().unwrap()) as usize;
    if payload_len != bytes.len() - 48 {
        return Err(TENUN_JS_ERR_BUNDLE_LENGTH);
    }
    let digest: [u8; 32] = bytes[16..48].try_into().unwrap();
    let mut hasher = Sha256::new();
    hasher.update(&bytes[48..]);
    let computed: [u8; 32] = hasher.finalize().into();
    if digest != computed {
        return Err(TENUN_JS_ERR_BUNDLE_DIGEST);
    }
    Ok(&bytes[48..])
}

#[no_mangle]
pub unsafe extern "C" fn tenun_js_eval_bundle(
    vm: *mut TenunJsVm,
    bytes: *const u8,
    len: usize,
) -> i32 {
    let vm = &mut *vm;
    let slice = std::slice::from_raw_parts(bytes, len);
    let source = match validate_bundle(slice) {
        Ok(s) => s,
        Err(e) => return e,
    };
    vm.state.interrupted.store(false, Ordering::Relaxed);
    let code = match std::str::from_utf8(source) {
        Ok(c) => c.to_string(),
        Err(_) => {
            vm.set_error("bundle payload is not valid UTF-8");
            return TENUN_JS_ERR_EVAL;
        }
    };
    let result: Result<Option<f64>, rquickjs::Error> = vm
        .context
        .with(|ctx| ctx.eval(code.as_bytes()).map(|v: Value| v.as_number()));
    match result {
        Ok(num) => {
            vm.state.result_f64.set(num.unwrap_or(f64::NAN));
            TENUN_JS_OK
        }
        Err(err) => {
            if vm.state.interrupted.load(Ordering::Relaxed) {
                vm.set_error("evaluation exceeded deadline");
                TENUN_JS_ERR_TIMEOUT
            } else {
                let msg = match err {
                    rquickjs::Error::Exception => vm.context.with(|ctx: Ctx| {
                        let exc = ctx.catch();
                        if let Some(m) = exc.as_string() {
                            m.to_string().unwrap_or_else(|_| "exception".to_string())
                        } else if !exc.is_undefined() && !exc.is_null() {
                            format!("{:?}", exc.type_of())
                        } else {
                            "exception".to_string()
                        }
                    }),
                    other => format!("{other}"),
                };
                vm.set_error(&msg);
                TENUN_JS_ERR_EVAL
            }
        }
    }
}

#[no_mangle]
pub unsafe extern "C" fn tenun_js_last_result(vm: *mut TenunJsVm, out: *mut ValueC) -> i32 {
    let vm = &*vm;
    if out.is_null() {
        return TENUN_JS_ERR_VALUE_BOUNDS;
    }
    let v = vm.state.result_f64.get();
    if v.is_nan() {
        (*out).kind = ValueKindC::Null;
    } else {
        (*out).kind = ValueKindC::F64;
        (*out).as_.f64v = v;
    }
    TENUN_JS_OK
}

#[no_mangle]
pub unsafe extern "C" fn tenun_js_register_host_fn(
    vm: *mut TenunJsVm,
    name: *const u8,
    name_len: usize,
) -> i32 {
    let vm = &mut *vm;
    if name_len == 0 || name_len > 128 {
        return TENUN_JS_ERR_REGISTRATION;
    }
    let slice = std::slice::from_raw_parts(name, name_len);
    let fname = match std::str::from_utf8(slice) {
        Ok(s) => s.to_string(),
        Err(_) => return TENUN_JS_ERR_REGISTRATION,
    };
    if fname != "onFirstFrame" {
        return TENUN_JS_ERR_REGISTRATION;
    }
    let called = vm.state.host_called.clone();
    let res: rquickjs::Result<()> = vm.context.with(|ctx: Ctx| -> rquickjs::Result<()> {
        ctx.globals().set(
            "onFirstFrame",
            Func::from(move || {
                called.store(true, Ordering::Relaxed);
            }),
        )?;
        Ok(())
    });
    match res {
        Ok(()) => TENUN_JS_OK,
        Err(_) => TENUN_JS_ERR_REGISTRATION,
    }
}

#[no_mangle]
pub unsafe extern "C" fn tenun_js_pump(vm: *mut TenunJsVm, max_jobs: i64) -> i64 {
    let vm = &*vm;
    let mut drained = 0i64;
    while drained < max_jobs {
        match vm.runtime.execute_pending_job() {
            Ok(true) => drained += 1,
            _ => break,
        }
    }
    drained
}

#[no_mangle]
pub unsafe extern "C" fn tenun_js_interrupt_flag(vm: *mut TenunJsVm) -> *const i64 {
    let vm = &*vm;
    &*vm.state.deadline_ms as *const AtomicI64 as *const i64
}

#[no_mangle]
pub extern "C" fn tenun_js_set_deadline_ms(vm: *mut TenunJsVm, deadline_ms: i64) {
    let vm = unsafe { &*vm };
    vm.state.deadline_ms.store(deadline_ms, Ordering::Relaxed);
}

#[no_mangle]
pub unsafe extern "C" fn tenun_js_host_was_called(vm: *mut TenunJsVm) -> i32 {
    let vm = &*vm;
    vm.state.host_called.load(Ordering::Relaxed) as i32
}

#[no_mangle]
pub unsafe extern "C" fn tenun_js_last_error(vm: *mut TenunJsVm) -> ErrorC {
    let vm = &*vm;
    let mut err = ErrorC {
        message: [0u8; 256],
        line: -1,
        column: -1,
    };
    if let Some((msg, line, col)) = &*vm.state.last_error.borrow() {
        let bytes = msg.as_bytes();
        let n = bytes.len().min(255);
        err.message[..n].copy_from_slice(&bytes[..n]);
        err.line = *line;
        err.column = *col;
    }
    err
}
