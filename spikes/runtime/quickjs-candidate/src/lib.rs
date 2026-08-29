// FFI spike scope: full per-fn # Safety sections arrive with the production
// engine surface (M2+); cross-boundary rules live in the contract doc beside
// each header.
#![allow(clippy::missing_safety_doc)]
// Vec<Box<T>> in deferred-drop storage is required for heap address stability:
// when an object is logically destroyed mid-operation, outer frames hold active
// raw pointers/references that must continue pointing to valid heap memory.
#![allow(clippy::vec_box)]

use std::cell::{Cell, RefCell};
use std::collections::HashMap;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::thread::ThreadId;

use rquickjs::function::{Func, Rest};
use rquickjs::{ArrayBuffer, BigInt, Coerced, Context, Ctx, Runtime, Value};
use sha2::{Digest, Sha256};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn eval_stack_recovers_from_panic() {
        let prev_hook = std::panic::take_hook();
        std::panic::set_hook(Box::new(|_| {})); // silence injected panic
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            eval_vm_push(EvalVm {
                raw: std::ptr::dangling_mut::<TenunJsVm>(),
                handle: std::ptr::null_mut(),
                slot: 7,
            });
            let _g = EvalGuard;
            panic!("injected during evaluation");
        }));
        std::panic::set_hook(prev_hook);
        assert!(result.is_err());
        // the guard popped the pushed context during unwind: no stale state
        assert!(eval_vm_current().is_none(), "stale EvalVm after panic");
        assert!(!eval_vm_has_slot(7), "stale slot after panic");
        // normal nesting still works afterwards
        eval_vm_push(EvalVm {
            raw: std::ptr::null_mut(),
            handle: std::ptr::null_mut(),
            slot: 1,
        });
        eval_vm_push(EvalVm {
            raw: std::ptr::null_mut(),
            handle: std::ptr::null_mut(),
            slot: 2,
        });
        assert!(eval_vm_has_slot(1) && eval_vm_has_slot(2));
        eval_vm_pop();
        eval_vm_pop();
        assert!(eval_vm_current().is_none());
    }
}

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
pub const TENUN_JS_ERR_HANDLE: i32 = 12;

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
    /// completion value of the last successful evaluation (review 5: all six
    /// bounded kinds; oversized/unrepresentable completions are flagged)
    result: RefCell<OwnedResult>,
}

/// Full bounded-kind completion value owned by the adapter. Strings/bytes
/// live in the same buffer pool as callback marshalling values.
enum OwnedResult {
    Null,
    F64(f64),
    I64(i64),
    Bool(bool),
    String(Vec<u8>),
    Bytes(Vec<u8>),
    /// completion existed but cannot cross the ABI within documented caps
    Unrepresentable,
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

// ---- opaque handle registry (H1): slot + generation -------------------------
//
// The `tenun_js_vm*` values crossing the ABI are NOT pointers into the VM;
// they encode (slot, generation). destroy() bumps the slot's generation, so
// every use-after-destroy and double-destroy fails closed with ERR_HANDLE
// instead of reaching freed memory. Slots recycle; a (slot, generation) pair
// is never reissued.
//
// Split storage keeps this free of unsafe Send impls: the global registry
// holds only Send+Sync data (generation + the interrupt flag Arc) so the
// cross-thread watchdog path never touches VM memory; the VM boxes live in a
// thread-local owner map (review-3 hardening: destroyed VMs are PARKED, not
// freed — a host callback may destroy its own VM mid-eval while outer frames
// still hold references; parked boxes drain at public-entry boundaries via
// op-depth guards. Reentrant eval/pump/register on a VM that is already
// evaluating is rejected fail-closed with ERR_HANDLE.)
// thread-local owner map, which is also what makes affinity detection exact.
struct GlobalSlot {
    generation: u32,
    flag: Arc<AtomicI32>,
}

struct HandleRegistry {
    slots: Vec<GlobalSlot>,
    free: Vec<u32>,
}

static HANDLE_REGISTRY: LazyLock<Mutex<HandleRegistry>> = LazyLock::new(|| {
    Mutex::new(HandleRegistry {
        slots: Vec::new(),
        free: Vec::new(),
    })
});

struct OwnedVm {
    generation: u32,
    vm: Box<TenunJsVm>,
}

thread_local! {
    /// VM boxes destroyed while an operation may still hold references
    /// (a host callback destroying its own VM mid-eval) are parked here as
    /// heap Boxes and freed at public-entry boundaries via op-depth guards.
    /// Preserving the Box allocation maintains address stability so outer
    /// stack frames and references continue pointing to valid heap memory.
    static DEFERRED_VMS: RefCell<Vec<Box<TenunJsVm>>> = const { RefCell::new(Vec::new()) };
    /// nesting depth of public adapter entries; only the 1 -> 0 transition
    /// drains parked boxes so nested calls from callbacks cannot free memory
    /// the outer frame still references
    static OP_DEPTH: Cell<u32> = const { Cell::new(0) };
}

struct OpGuard;

impl OpGuard {
    fn enter() -> Self {
        OP_DEPTH.with(|d| {
            if d.get() == 0 {
                drain_deferred();
            }
            d.set(d.get() + 1);
        });
        OpGuard
    }
}

impl Drop for OpGuard {
    fn drop(&mut self) {
        OP_DEPTH.with(|d| {
            d.set(d.get().saturating_sub(1));
            if d.get() == 0 {
                drain_deferred();
            }
        });
    }
}

fn drain_deferred() {
    DEFERRED_VMS.with(|d| d.borrow_mut().clear());
}

thread_local! {
    static OWNER_VMS: RefCell<HashMap<u32, OwnedVm>> = RefCell::new(HashMap::new());
}

fn lock_registry() -> std::sync::MutexGuard<'static, HandleRegistry> {
    // poison-tolerant: a panic in one caller must not brick the process
    HANDLE_REGISTRY
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

const HANDLE_GEN_SHIFT: u64 = 32;

fn encode_handle(slot: u32, generation: u32) -> *mut TenunJsVm {
    (((generation as u64) << HANDLE_GEN_SHIFT) | (slot as u64 + 1)) as *mut TenunJsVm
}

fn decode_handle(handle: *mut TenunJsVm) -> Option<(u32, u32)> {
    if handle.is_null() {
        return None;
    }
    let bits = handle as usize as u64;
    let slot = (bits & 0xFFFF_FFFF).checked_sub(1)? as u32;
    Some((slot, (bits >> HANDLE_GEN_SHIFT) as u32))
}

fn registry_insert(vm: TenunJsVm) -> *mut TenunJsVm {
    let boxed = Box::new(vm);
    let flag = boxed.state.flag.clone();
    let mut reg = lock_registry();
    let (slot, generation) = match reg.free.pop() {
        Some(slot) => {
            let s = &mut reg.slots[slot as usize];
            s.flag = flag;
            (slot, s.generation)
        }
        None => {
            reg.slots.push(GlobalSlot {
                generation: 1,
                flag,
            });
            ((reg.slots.len() - 1) as u32, 1)
        }
    };
    OWNER_VMS.with(|m| {
        m.borrow_mut().insert(
            slot,
            OwnedVm {
                generation,
                vm: boxed,
            },
        );
    });
    encode_handle(slot, generation)
}

/// Null handles map to ERR_ARGUMENT (existing contract). Handles whose slot
/// generation no longer matches — destroyed, forged, or from another library
/// instance — map to ERR_HANDLE. A live handle presented on the wrong thread
/// maps to ERR_AFFINITY without ever touching that thread's memory.
fn registry_resolve(handle: *mut TenunJsVm) -> Result<*mut TenunJsVm, i32> {
    let (slot, generation) = match decode_handle(handle) {
        Some(pair) => pair,
        None => return Err(TENUN_JS_ERR_ARGUMENT),
    };
    let globally_live = {
        let reg = lock_registry();
        reg.slots
            .get(slot as usize)
            .is_some_and(|s| s.generation == generation)
    };
    if !globally_live {
        return Err(TENUN_JS_ERR_HANDLE);
    }
    OWNER_VMS.with(|m| {
        let map = m.borrow();
        match map.get(&slot) {
            Some(owned) if owned.generation == generation => {
                Ok(&*owned.vm as *const TenunJsVm as *mut TenunJsVm)
            }
            // globally live but not on this thread: affinity, not invalidity
            _ => Err(TENUN_JS_ERR_AFFINITY),
        }
    })
}

/// Owner-thread destroy only: the Box lives in this thread's map, so a
/// destroy racing from another thread is a safe no-op (documented contract).
fn registry_release(handle: *mut TenunJsVm) {
    let Some((slot, generation)) = decode_handle(handle) else {
        return;
    };
    let taken = OWNER_VMS.with(|m| {
        let mut map = m.borrow_mut();
        match map.remove(&slot) {
            Some(owned) if owned.generation == generation => Some(owned),
            _ => None, // stale handle (already destroyed) — no-op
        }
    });
    if taken.is_some() {
        let mut reg = lock_registry();
        if reg
            .slots
            .get(slot as usize)
            .is_some_and(|s| s.generation == generation)
        {
            if let Some(next_gen) = reg.slots[slot as usize].generation.checked_add(1) {
                reg.slots[slot as usize].generation = next_gen;
                reg.free.push(slot);
            }
            // generation overflow: slot retired permanently
        }
        // review-3/4 hardening: park the Box directly to maintain address
        // stability for any outer stack frames holding references to this VM
        if let Some(owned) = taken {
            DEFERRED_VMS.with(|d| d.borrow_mut().push(owned.vm));
        }
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
        TENUN_JS_ERR_HANDLE => "HANDLE",
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

#[derive(Clone, Copy)]
struct EvalVm {
    raw: *mut TenunJsVm,
    // the handle the embedder passed in — what host callbacks receive back
    handle: *mut TenunJsVm,
    // registry slot of the evaluating VM; reentrant adapter calls targeting
    // it fail closed (review 3)
    slot: u32,
}

thread_local! {
    // STACK of evaluation contexts (review 5): a host callback may legally
    // evaluate a DIFFERENT VM (cross-VM nesting); each eval pushes its
    // context and pops/restores the previous one on exit, so the trampoline
    // always finds the context of the VM actually executing. Same-VM
    // reentrancy is rejected before the push.
    static EVAL_VM: RefCell<Vec<EvalVm>> = const { RefCell::new(Vec::new()) };
}

fn eval_vm_push(ev: EvalVm) {
    EVAL_VM.with(|s| s.borrow_mut().push(ev));
}

fn eval_vm_pop() {
    EVAL_VM.with(|s| {
        s.borrow_mut().pop();
    });
}

fn eval_vm_current() -> Option<EvalVm> {
    EVAL_VM.with(|s| s.borrow().last().copied())
}

fn eval_vm_has_slot(slot: u32) -> bool {
    EVAL_VM.with(|s| s.borrow().iter().any(|ev| ev.slot == slot))
}

/// RAII pair for `eval_vm_push`: pops the context on every exit path,
/// including unwinds, so a caught panic can never leave stale evaluation
/// state in TLS (review 6).
struct EvalGuard;

impl Drop for EvalGuard {
    fn drop(&mut self) {
        eval_vm_pop();
    }
}

/// Exact decimal-string -> i64 (review 6). `JS_ToInt64Ext` on BigInt values
/// wraps modulo 2^64 (BF_GET_INT_MOD), silently corrupting out-of-range
/// magnitudes — so the adapter range-checks the decimal representation
/// itself and rejects anything outside the int64 domain.
fn bigint_i64_from_decimal(s: &str) -> Option<i64> {
    let (neg, digits) = match s.strip_prefix('-') {
        Some(d) => (true, d),
        None => (false, s),
    };
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let mut mag: i128 = 0;
    for b in digits.bytes() {
        mag = mag * 10 + (b - b'0') as i128;
        if mag > (i64::MAX as i128) + 1 {
            return None;
        }
    }
    let signed = if neg { -mag } else { mag };
    if signed < i64::MIN as i128 || signed > i64::MAX as i128 {
        None
    } else {
        Some(signed as i64)
    }
}

/// JS -> bounded value. Oversized strings/byte payloads fail with
/// VALUE_BOUNDS and the argument is dropped (reflected in reduced argc) —
/// documented truncation semantics, never silent content truncation.
fn js_to_bound(_ctx: &Ctx<'_>, vm: &TenunJsVm, v: &Value<'_>, out: &mut ValueC) -> i32 {
    if v.is_undefined() || v.is_null() {
        out.kind = VK_NULL;
        return TENUN_JS_OK;
    }
    // review 6: BigInt arguments bridge exactly; anything outside the int64
    // domain fails VALUE_BOUNDS (dropped-argument semantics) — never wraps
    if v.as_big_int().is_some() {
        let s: Coerced<String> = match v.clone().get() {
            Ok(s) => s,
            Err(_) => return TENUN_JS_ERR_VALUE_BOUNDS,
        };
        return match bigint_i64_from_decimal(&s.0) {
            Some(i) => {
                out.kind = VK_I64;
                out.as_.i64v = i;
                TENUN_JS_OK
            }
            None => TENUN_JS_ERR_VALUE_BOUNDS,
        };
    }
    if let Some(b) = v.as_bool() {
        out.kind = VK_BOOL;
        out.as_.bool_value = b as i32;
        return TENUN_JS_OK;
    }
    // review 7: source-type semantics — every JavaScript Number crosses the
    // ABI as F64 regardless of the engine's internal integer optimization;
    // VK_I64 is reserved for BigInt (see branch above).
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
            // review 6: exact i64 -> BigInt. The old i32/f64 fallback
            // silently rounded magnitudes above 2^53 (and above i32).
            VK_I64 => {
                let big =
                    BigInt::from_i64(ctx.clone(), out.as_.i64v).map_err(|_| TENUN_JS_ERR_EVAL)?;
                Ok(big.into_value())
            }
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
    let Some(ev) = eval_vm_current() else {
        return Ok(Value::new_null(ctx));
    };
    let vm = unsafe { &*ev.raw };
    let stored = match vm.state.host_fn.borrow().as_ref() {
        Some(f) => *f,
        None => return Ok(Value::new_null(ctx)),
    };
    if args.len() > MAX_ARGS {
        // review 7: the published limit is enforced observably — the call
        // still runs with the first MAX_ARGS arguments, but the overflow is
        // recorded instead of being silently ignored
        vm.set_error(
            "VALUE_BOUNDS",
            "host call exceeded TENUN_JS_MAX_ARGS; excess arguments dropped",
        );
    }
    let mut converted: [ValueC; MAX_ARGS] = unsafe { std::mem::zeroed() };
    let mut n = 0usize;
    for a in args.iter().take(MAX_ARGS) {
        match js_to_bound(&ctx, vm, a, &mut converted[n]) {
            TENUN_JS_OK => n += 1,
            // documented truncation semantics: failed conversion drops the
            // argument from the tail; VALUE_BOUNDS recorded per occurrence
            code => {
                let msg = format!(
                    "TJERR:VALUE_BOUNDS: argument dropped ({})",
                    status_cat(code)
                );
                vm.set_error("VALUE_BOUNDS", &msg[14..]);
            }
        }
    }
    let out = stored(ev.handle, converted.as_ptr(), n);
    bound_to_js(ctx.clone(), &out).map_err(|code| {
        let msg = format!("TJERR:{}: host callback return rejected", status_cat(code));
        vm.set_error(status_cat(code), "host callback return rejected");
        rquickjs::Exception::throw_message(&ctx, &msg)
    })
}

#[no_mangle]
pub unsafe extern "C" fn tenun_js_create(cfg: *const ConfigC) -> *mut TenunJsVm {
    let _g = OpGuard::enter();
    catch_unwind(AssertUnwindSafe(|| {
        if cfg.is_null() {
            return std::ptr::null_mut();
        }
        let c = unsafe { &*cfg };
        if c.abi_version != ABI_VERSION {
            return std::ptr::null_mut();
        }
        // fail-closed config (review 5): unsupported values are REJECTED,
        // never silently ignored. interrupt_poll_ms is reserved-for-future
        // and must be 0; heap limits must be 0 (unlimited) or within the
        // supported 32-bit range the runtime can enforce exactly.
        if c.interrupt_poll_ms != 0 {
            return std::ptr::null_mut();
        }
        if c.max_heap_bytes > u32::MAX as u64 {
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
        registry_insert(TenunJsVm {
            runtime: rt,
            context: ctx,
            state: VmState {
                interrupted,
                flag,
                owner: std::thread::current().id(),
                host_fn: RefCell::new(None),
                buffers: RefCell::new(Vec::new()),
                last_error: RefCell::new(None),
                result: RefCell::new(OwnedResult::Null),
            },
        })
    }))
    .unwrap_or(std::ptr::null_mut())
}

#[no_mangle]
pub unsafe extern "C" fn tenun_js_destroy(vm: *mut TenunJsVm) {
    let _g = OpGuard::enter();
    catch_unwind(AssertUnwindSafe(|| registry_release(vm))).ok();
}

/// Completion-value bridge (review 5): the last evaluation result is exposed
/// as a full bounded value. Kinds that cannot cross the ABI (objects,
/// functions, oversized strings/bytes) become `Unrepresentable` and surface
/// as TENUN_JS_ERR_VALUE_BOUNDS from tenun_js_last_result — never silent
/// coercion to null.
fn owned_from_value(_vm: &TenunJsVm, _ctx: &Ctx<'_>, v: &Value<'_>) -> OwnedResult {
    if v.is_undefined() || v.is_null() {
        return OwnedResult::Null;
    }
    // review 6: BigInt completions bridge as exact I64; magnitudes outside
    // int64 are Unrepresentable (surfaces as VALUE_BOUNDS), never wrapped
    if v.as_big_int().is_some() {
        let s: Coerced<String> = match v.clone().get() {
            Ok(s) => s,
            Err(_) => return OwnedResult::Unrepresentable,
        };
        return match bigint_i64_from_decimal(&s.0) {
            Some(i) => OwnedResult::I64(i),
            None => OwnedResult::Unrepresentable,
        };
    }
    if let Some(b) = v.as_bool() {
        return OwnedResult::Bool(b);
    }
    // review 7: Number => F64 (source-type model); I64 only via BigInt
    if let Some(f) = v.as_number() {
        return OwnedResult::F64(f);
    }
    if let Some(sv) = v.as_string() {
        if let Ok(text) = sv.to_string() {
            if text.len() <= MAX_STRING_BYTES {
                return OwnedResult::String(text.as_bytes().to_vec());
            }
        }
        return OwnedResult::Unrepresentable;
    }
    if let Some(obj) = v.as_object() {
        if obj.is_array_buffer() {
            if let Some(ab) = obj.as_array_buffer() {
                if let Some(raw) = ab.as_bytes() {
                    if raw.len() <= MAX_BYTES {
                        return OwnedResult::Bytes(raw.to_vec());
                    }
                }
            }
        }
    }
    OwnedResult::Unrepresentable
}

unsafe fn eval_checked(handle: *mut TenunJsVm, bytes: *const u8, len: usize) -> i32 {
    // review 7: resolve the handle BEFORE argument validation so every failed
    // call with a resolvable VM overwrites last_error
    let vm = match registry_resolve(handle) {
        Ok(p) => p,
        Err(e) => return e,
    };
    let vm = &*vm;
    if bytes.is_null() || len > MAX_BUNDLE_BYTES {
        vm.set_error(
            "ARGUMENT",
            if bytes.is_null() {
                "bundle pointer is NULL"
            } else {
                "bundle exceeds maximum size"
            },
        );
        return TENUN_JS_ERR_ARGUMENT;
    }
    let _g = OpGuard::enter();
    let (slot, _generation) = match decode_handle(handle) {
        Some(p) => p,
        None => {
            vm.set_error("ARGUMENT", "handle is NULL");
            return TENUN_JS_ERR_ARGUMENT;
        }
    };
    // reentrancy: a host callback calling eval back into the VM that is
    // currently evaluating would corrupt the per-eval stash; fail closed
    if eval_vm_has_slot(slot) {
        vm.set_error("HANDLE", "reentrant adapter call on evaluating VM");
        return TENUN_JS_ERR_HANDLE;
    }
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
    eval_vm_push(EvalVm {
        raw: vm as *const TenunJsVm as *mut TenunJsVm,
        handle,
        slot,
    });
    let _eval_guard = EvalGuard; // pop on every path, panics included

    let result: Result<OwnedResult, rquickjs::Error> = vm.context.with(|ctx| {
        let v: Value<'_> = ctx.eval(code.as_bytes())?;
        Ok(owned_from_value(vm, &ctx, &v))
    });

    match result {
        Ok(owned) => {
            *vm.state.result.borrow_mut() = owned;
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

unsafe fn register_checked(handle: *mut TenunJsVm, name: *const u8, fn_ptr: Option<HostFn>) -> i32 {
    // review 7: resolve the handle BEFORE argument validation so every failed
    // call with a resolvable VM overwrites last_error
    let vm = match registry_resolve(handle) {
        Ok(p) => p,
        Err(e) => return e,
    };
    let vm = &*vm;
    if name.is_null() || fn_ptr.is_none() {
        vm.set_error(
            "ARGUMENT",
            if name.is_null() {
                "name pointer is NULL"
            } else {
                "function pointer is NULL"
            },
        );
        return TENUN_JS_ERR_ARGUMENT;
    }
    let _g = OpGuard::enter();
    let (slot, _) = match decode_handle(handle) {
        Some(p) => p,
        None => {
            vm.set_error("ARGUMENT", "handle is NULL");
            return TENUN_JS_ERR_ARGUMENT;
        }
    };
    if eval_vm_has_slot(slot) {
        vm.set_error("HANDLE", "reentrant registration on evaluating VM");
        return TENUN_JS_ERR_HANDLE;
    }
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
            Ok(f) => {
                if f.is_empty() {
                    vm.set_error("ARGUMENT", "host fn name is empty");
                    return TENUN_JS_ERR_ARGUMENT;
                }
                f.to_string()
            }
            Err(_) => {
                vm.set_error("ARGUMENT", "host fn name is not valid UTF-8");
                return TENUN_JS_ERR_ARGUMENT;
            }
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
        // argument validation happens before any VM touch: record diagnostic
        // through the registry only when the handle is resolvable
        if max_jobs < 0 {
            if let Ok(p) = registry_resolve(vm) {
                (*p).set_error("ARGUMENT", "negative max_jobs");
            }
            return -1i64;
        }
        let _g = OpGuard::enter();
        let (slot, _) = match decode_handle(vm) {
            Some(p) => p,
            None => return -1i64,
        };
        if eval_vm_has_slot(slot) {
            if let Ok(p) = registry_resolve(vm) {
                (*p).set_error("HANDLE", "reentrant pump during evaluation");
            }
            return -1i64; // reentrant pump during evaluation
        }
        let vm = match registry_resolve(vm) {
            Ok(p) => p,
            // unresolvable here means stale or cross-thread: last_error is
            // either unreachable (zombie) or foreign-thread state — no write
            Err(_) => return -1i64,
        };
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
        vm.clear_error();
        drained
    }))
    .unwrap_or(-1)
}

#[no_mangle]
pub unsafe extern "C" fn tenun_js_request_interrupt(vm: *mut TenunJsVm) -> i32 {
    // deliberately NOT affinity-checked: watchdog threads may call freely.
    // The flag Arc is cloned while the registry lock is held, so a concurrent
    // destroy can never leave this touching freed memory. Per header contract
    // (review 5): this path never touches last_error — it is the one
    // documented cross-thread exception to clear/overwrite semantics.
    catch_unwind(AssertUnwindSafe(|| {
        let (slot, generation) = match decode_handle(vm) {
            Some(pair) => pair,
            None => return TENUN_JS_ERR_ARGUMENT,
        };
        let flag = {
            let reg = lock_registry();
            match reg.slots.get(slot as usize) {
                Some(s) if s.generation == generation => s.flag.clone(),
                _ => return TENUN_JS_ERR_HANDLE,
            }
        };
        flag.store(1, Ordering::SeqCst);
        TENUN_JS_OK
    }))
    .unwrap_or(TENUN_JS_ERR_ARGUMENT)
}

#[no_mangle]
pub unsafe extern "C" fn tenun_js_clear_interrupt(vm: *mut TenunJsVm) -> i32 {
    catch_unwind(AssertUnwindSafe(|| {
        let vm = match registry_resolve(vm) {
            Ok(p) => p,
            Err(e) => return e,
        };
        let vm = &*vm;
        if !vm.owner_ok() {
            vm.set_error("AFFINITY", "clear_interrupt from non-owner thread");
            return TENUN_JS_ERR_AFFINITY;
        }
        vm.state.flag.store(0, Ordering::SeqCst);
        vm.state.interrupted.store(false, Ordering::SeqCst);
        vm.clear_error(); // header contract: successful call clears diagnostics (review 6)
        TENUN_JS_OK
    }))
    .unwrap_or(TENUN_JS_ERR_ARGUMENT)
}

#[no_mangle]
pub unsafe extern "C" fn tenun_js_last_result(vm: *mut TenunJsVm, out: *mut ValueC) -> i32 {
    catch_unwind(AssertUnwindSafe(|| {
        let _g = OpGuard::enter();
        let vm = match registry_resolve(vm) {
            Ok(p) => p,
            Err(e) => return e,
        };
        let vm = &*vm;
        if out.is_null() {
            vm.set_error("ARGUMENT", "out pointer is NULL");
            return TENUN_JS_ERR_ARGUMENT;
        }
        let result = vm.state.result.borrow();
        match &*result {
            OwnedResult::Null => {
                (*out).kind = VK_NULL;
            }
            OwnedResult::F64(v) => {
                (*out).kind = VK_F64;
                (*out).as_.f64v = *v;
            }
            OwnedResult::I64(v) => {
                (*out).kind = VK_I64;
                (*out).as_.i64v = *v;
            }
            OwnedResult::Bool(v) => {
                (*out).kind = VK_BOOL;
                (*out).as_.bool_value = *v as i32;
            }
            OwnedResult::String(bytes) => {
                let (ptr, len) = vm.store_bytes(bytes);
                (*out).kind = VK_STRING;
                (*out).as_.string = StrC { data: ptr, len };
            }
            OwnedResult::Bytes(bytes) => {
                let (ptr, len) = vm.store_bytes(bytes);
                (*out).kind = VK_BYTES;
                (*out).as_.bytes = StrC { data: ptr, len };
            }
            OwnedResult::Unrepresentable => {
                vm.set_error("VALUE_BOUNDS", "completion value is not representable");
                return TENUN_JS_ERR_VALUE_BOUNDS;
            }
        }
        vm.clear_error(); // header contract: successful call clears diagnostics (review 6)
        TENUN_JS_OK
    }))
    .unwrap_or(TENUN_JS_ERR_ARGUMENT)
}

#[no_mangle]
pub unsafe extern "C" fn tenun_js_last_error(vm: *mut TenunJsVm) -> ErrorC {
    // by-value return has no channel for a status: null and stale handles
    // yield the empty fallback rather than touching freed memory
    let fallback = ErrorC {
        message: [0u8; 256],
        line: -1,
        column: -1,
    };
    let vm = match registry_resolve(vm) {
        Ok(p) => p,
        Err(_) => return fallback,
    };
    let vm = &*vm;
    let mut err = fallback;
    if let Some(msg) = &*vm.state.last_error.borrow() {
        let bytes = msg.as_bytes();
        let n = bytes.len().min(255);
        err.message[..n].copy_from_slice(&bytes[..n]);
    }
    err
}
