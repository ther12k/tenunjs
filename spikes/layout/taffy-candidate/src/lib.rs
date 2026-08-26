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
use std::hash::{BuildHasher, Hasher};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::{LazyLock, Mutex};

use taffy::prelude::*;

pub const TENUN_LAYOUT_OK: i32 = 0;
pub const TENUN_LAYOUT_ERR_STYLE: i32 = 1;
pub const TENUN_LAYOUT_ERR_TREE: i32 = 2;
pub const TENUN_LAYOUT_ERR_HANDLE: i32 = 3;

#[repr(C)]
#[derive(Clone, Copy)]
pub struct StyleC {
    pub width: f32,
    pub height: f32,
    pub flex_grow: f32,
    pub direction: u32,
    pub gap: f32,
    pub padding: f32,
    pub justify_content: u32,
    pub align_items: u32,
}

#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct BoxC {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

pub type MeasureFn = extern "C" fn(userdata: *mut u8, constraint: ConstraintC, out: *mut BoxC);

#[repr(C)]
#[derive(Clone, Copy)]
pub struct ConstraintC {
    pub available_width: f32,
    pub available_height: f32,
}

#[derive(Clone, Copy)]
pub struct MeasureHook {
    pub func: MeasureFn,
    pub userdata: *mut u8,
}

pub struct NodeData {
    pub style: StyleC,
    pub measure: Option<MeasureHook>,
    pub children: Vec<*mut NodeData>,
    pub parent: Option<*mut NodeData>,
    pub result: BoxC,
}

impl NodeData {
    fn new() -> Self {
        Self {
            style: StyleC {
                width: f32::NAN,
                height: f32::NAN,
                flex_grow: 0.0,
                direction: 0,
                gap: 0.0,
                padding: 0.0,
                justify_content: 0,
                align_items: 0,
            },
            measure: None,
            children: Vec::new(),
            parent: None,
            result: BoxC {
                x: 0.0,
                y: 0.0,
                width: 0.0,
                height: 0.0,
            },
        }
    }
}

fn dim(v: f32) -> Dimension {
    if v.is_nan() {
        Dimension::Auto
    } else {
        Dimension::Length(v)
    }
}

// ---- opaque handle registry (H1, review-3 hardening) -----------------------
//
// Tokens crossing the ABI encode [nonce:16 | generation:20 | slot+1:28]:
//   nonce      random per library instance — a yoga token can never validate
//              inside taffy (or any other instance) even if slots align;
//   slot       ONE process-global counter — two threads creating their first
//              node get DIFFERENT slots, so tokens cannot alias across
//              threads (fixes the review-3 collision in pure-TLS counters);
//   generation bumped on destroy; a (slot, generation) pair is never issued
//              again, so stale handles can never alias a fresh node.
//
// Metadata lives in one global Send+Sync table (generation + owner thread);
// Box<NodeData> values live only in the OWNING thread's local map, which
// keeps non-Send types out of statics without unsafe impls. The spike layout
// contract is single-threaded per tree: a token presented off its creating
// thread resolves as ERR_HANDLE (fail closed), same for foreign tokens.
struct SlotMeta {
    generation: u32,
    owner: std::thread::ThreadId,
}

struct GlobalRegistry {
    slots: Vec<SlotMeta>,
    free: Vec<u32>,
    next_slot: u32,
    nonce: u16,
}

static GLOBAL_REGISTRY: LazyLock<Mutex<GlobalRegistry>> = LazyLock::new(|| {
    // per-process randomness without extra deps: RandomState seeds itself
    // from OS entropy on every construction
    let mut h = std::collections::hash_map::RandomState::new().build_hasher();
    h.write_u32(0x7465_6e75); // "tenu"
    Mutex::new(GlobalRegistry {
        slots: Vec::new(),
        free: Vec::new(),
        next_slot: 0,
        nonce: h.finish() as u16,
    })
});

fn lock_global() -> std::sync::MutexGuard<'static, GlobalRegistry> {
    // poison-tolerant: a panic in one caller must not brick the process
    GLOBAL_REGISTRY
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
}

const NONCE_SHIFT: u64 = 48;
const GEN_SHIFT: u64 = 28;
const MAX_GENERATION: u32 = 0xF_FFFF; // 20-bit generation ceiling before slot retirement

fn encode_handle(nonce: u16, slot: u32, generation: u32) -> *mut NodeData {
    (((nonce as u64) << NONCE_SHIFT)
        | (((generation as u64) & (MAX_GENERATION as u64)) << GEN_SHIFT)
        | ((slot as u64 + 1) & 0xFFF_FFFF)) as *mut NodeData
}

fn decode_handle(handle: *mut NodeData) -> Option<(u16, u32, u32)> {
    if handle.is_null() {
        return None;
    }
    let bits = handle as usize as u64;
    let slot = (bits & 0xFFF_FFFF).checked_sub(1)?;
    Some((
        (bits >> NONCE_SHIFT) as u16,
        slot as u32,
        ((bits >> GEN_SHIFT) & (MAX_GENERATION as u64)) as u32,
    ))
}

struct OwnedNode {
    generation: u32,
    node: Box<NodeData>,
}

thread_local! {
    static OWNER_NODES: RefCell<HashMap<u32, OwnedNode>> = RefCell::new(HashMap::new());
    /// Nodes destroyed while a top-level operation may still hold references
    /// (compute runs C measure callbacks) are parked here as heap Boxes and
    /// freed at the next adapter entry drain — preserving the Box allocation
    /// keeps Rust heap addresses strictly stable for in-flight pointers.
    static DEFERRED_DROPS: RefCell<Vec<Box<NodeData>>> = const { RefCell::new(Vec::new()) };
}

/// Frees everything parked by mid-operation destroys. Called at every
/// adapter entry so nodes never linger past a boundary they could outlive.
fn drain_deferred() {
    DEFERRED_DROPS.with(|d| d.borrow_mut().clear());
}

thread_local! {
    /// nesting depth of public adapter entries; only the 1 -> 0 transition
    /// drains deferred drops (a nested call from a C callback must not free
    /// boxes the outer compute still references)
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

fn registry_insert(node: NodeData) -> *mut NodeData {
    let boxed = Box::new(node);
    let me = std::thread::current().id();
    let mut reg = lock_global();
    let (slot, generation) = match reg.free.pop() {
        Some(slot) => {
            reg.slots[slot as usize].owner = me;
            let generation = reg.slots[slot as usize].generation;
            (slot, generation)
        }
        None => {
            if reg.next_slot >= 0x0FFF_FFFF {
                // documented cap: token width exhausted
                return std::ptr::null_mut();
            }
            reg.slots.push(SlotMeta {
                generation: 1,
                owner: me,
            });
            let slot = reg.next_slot;
            reg.next_slot += 1;
            (slot, 1)
        }
    };
    let nonce = reg.nonce;
    drop(reg);
    OWNER_NODES.with(|m| {
        m.borrow_mut().insert(
            slot,
            OwnedNode {
                generation,
                node: boxed,
            },
        );
    });
    encode_handle(nonce, slot, generation)
}

/// Validation ladder: null/bad shape → legacy codes; unknown nonce,
/// unknown/stale generation (forged, foreign instance, destroyed) or token
/// owned by another thread → ERR_HANDLE. The Box pointer is re-derived from
/// THIS thread's map only — never trusted from the token bits.
fn registry_resolve(handle: *mut NodeData) -> Result<*mut NodeData, i32> {
    let (nonce, slot, generation) = match decode_handle(handle) {
        Some(p) => p,
        None => return Err(TENUN_LAYOUT_ERR_TREE), // null keeps legacy code
    };
    {
        let reg = lock_global();
        match reg.slots.get(slot as usize) {
            Some(meta) if meta.generation == generation && reg.nonce == nonce => {}
            _ => return Err(TENUN_LAYOUT_ERR_HANDLE),
        }
    }
    OWNER_NODES.with(|m| {
        let map = m.borrow();
        match map.get(&slot) {
            Some(owned) if owned.generation == generation => {
                Ok(&*owned.node as *const NodeData as *mut NodeData)
            }
            _ => Err(TENUN_LAYOUT_ERR_HANDLE),
        }
    })
}

/// Owner-thread destroy: marks the token dead IMMEDIATELY (generation bump)
/// so every later use anywhere fails closed; then parks the box for the next
/// drain instead of freeing it while a compute may still hold references.
/// A destroy presented from another thread finds no box here and is a
/// documented no-op (the owner's real object stays untouched).
fn registry_release(handle: *mut NodeData) {
    let (nonce, slot, generation) = match decode_handle(handle) {
        Some(p) => p,
        None => return,
    };
    let is_owner_live = {
        let mut reg = lock_global();
        let live = reg.slots.get(slot as usize).is_some_and(|meta| {
            meta.generation == generation
                && reg.nonce == nonce
                && meta.owner == std::thread::current().id()
        });
        if live {
            let next_gen = reg.slots[slot as usize].generation.saturating_add(1);
            reg.slots[slot as usize].generation = next_gen;
            // retire slot permanently if 20-bit generation ceiling is reached
            if next_gen <= MAX_GENERATION {
                reg.free.push(slot);
            }
        }
        live
    };
    if !is_owner_live {
        return;
    }
    if let Some(mut owned) = OWNER_NODES.with(|m| m.borrow_mut().remove(&slot)) {
        // lifecycle detach while we still own the box: no dangling parent
        // entry survives; children become unparented roots
        unsafe {
            if let Some(par) = owned.node.parent.take() {
                let raw = owned.node.as_mut() as *mut NodeData;
                (*par).children.retain(|&c| c != raw);
            }
            for &c in &owned.node.children {
                if !c.is_null() {
                    (*c).parent = None;
                }
            }
        }
        // preserve the Box allocation directly to maintain heap address stability
        DEFERRED_DROPS.with(|d| d.borrow_mut().push(owned.node));
    }
}

fn to_taffy_style(s: &StyleC) -> taffy::Style {
    taffy::Style {
        size: Size {
            width: dim(s.width),
            height: dim(s.height),
        },
        flex_grow: s.flex_grow,
        // kill engine defaults: spike subset is grow-only
        flex_shrink: 0.0,
        flex_direction: match s.direction {
            1 => FlexDirection::Column,
            _ => FlexDirection::Row,
        },
        gap: Size {
            width: LengthPercentage::Length(s.gap),
            height: LengthPercentage::Length(s.gap),
        },
        padding: Rect {
            left: LengthPercentage::Length(s.padding),
            right: LengthPercentage::Length(s.padding),
            top: LengthPercentage::Length(s.padding),
            bottom: LengthPercentage::Length(s.padding),
        },
        justify_content: Some(match s.justify_content {
            1 => JustifyContent::Center,
            _ => JustifyContent::FlexStart,
        }),
        align_items: Some(match s.align_items {
            1 => AlignItems::Center,
            _ => AlignItems::Stretch,
        }),
        ..Default::default()
    }
}

/// Dimensions accept NaN (=undefined) or finite non-negative points only;
/// infinities and negatives are style errors, never engine-dependent UB.
fn valid_dim(v: f32) -> bool {
    v.is_nan() || (v.is_finite() && v >= 0.0)
}

fn style_valid(s: &StyleC) -> bool {
    // +Inf satisfies `>= 0.0`, so scalars need explicit finiteness (review 3)
    s.flex_grow.is_finite()
        && s.flex_grow >= 0.0
        && s.gap.is_finite()
        && s.gap >= 0.0
        && s.padding.is_finite()
        && s.padding >= 0.0
        && valid_dim(s.width)
        && valid_dim(s.height)
        && s.direction <= 1
        && s.justify_content <= 1
        && s.align_items <= 1
}

/// Non-finite or negative intrinsic replies are replaced with zero before
/// reaching the engine: a misbehaving measurement hook degrades layout, it
/// can never inject NaN/Inf into scene state.
fn sanitize_size(width: f32, height: f32) -> (f32, f32) {
    (
        if width.is_finite() && width > 0.0 {
            width
        } else {
            0.0
        },
        if height.is_finite() && height > 0.0 {
            height
        } else {
            0.0
        },
    )
}

#[derive(Clone, Copy)]

pub struct MeasureCtx {
    pub hook: MeasureHook,
}

type SpikeTree = TaffyTree<MeasureCtx>;

fn build_tree(
    taffy: &mut SpikeTree,
    node: *mut NodeData,
    registry: &mut HashMap<usize, taffy::NodeId>,
) -> Result<taffy::NodeId, i32> {
    unsafe {
        let data = &mut *node;
        let style = to_taffy_style(&data.style);
        let id = if data.children.is_empty() {
            if let Some(hook) = data.measure {
                taffy
                    .new_leaf_with_context(style, MeasureCtx { hook })
                    .map_err(|_| TENUN_LAYOUT_ERR_TREE)?
            } else {
                taffy.new_leaf(style).map_err(|_| TENUN_LAYOUT_ERR_TREE)?
            }
        } else {
            let mut child_ids = Vec::with_capacity(data.children.len());
            for &c in &data.children {
                child_ids.push(build_tree(taffy, c, registry)?);
            }
            taffy
                .new_with_children(style, &child_ids)
                .map_err(|_| TENUN_LAYOUT_ERR_TREE)?
        };
        registry.insert(node as usize, id);
        Ok(id)
    }
}

unsafe fn store_results(
    taffy: &SpikeTree,
    node: *mut NodeData,
    registry: &HashMap<usize, taffy::NodeId>,
) {
    let data = &mut *node;
    let layout = taffy.layout(registry[&(node as usize)]).unwrap();
    data.result = BoxC {
        x: layout.location.x,
        y: layout.location.y,
        width: layout.size.width,
        height: layout.size.height,
    };
    for &c in &data.children {
        store_results(taffy, c, registry);
    }
}

#[no_mangle]
pub extern "C" fn tenun_layout_node_create() -> *mut NodeData {
    let _g = OpGuard::enter();
    catch_unwind(AssertUnwindSafe(|| registry_insert(NodeData::new())))
        .unwrap_or(std::ptr::null_mut())
}

#[no_mangle]
pub unsafe extern "C" fn tenun_layout_node_destroy(node: *mut NodeData) {
    let _g = OpGuard::enter();
    catch_unwind(AssertUnwindSafe(|| {
        registry_release(node); // parked when mid-operation; drains at boundary
    }))
    .ok(); // panic containment: destroy never unwinds across the ABI
}

#[no_mangle]
pub unsafe extern "C" fn tenun_layout_node_add_child(
    parent: *mut NodeData,
    child: *mut NodeData,
) -> i32 {
    catch_unwind(AssertUnwindSafe(|| {
        let _g = OpGuard::enter();
        if parent.is_null() || child.is_null() || parent == child {
            return TENUN_LAYOUT_ERR_TREE;
        }
        let parent = match registry_resolve(parent) {
            Ok(p) => p,
            Err(e) => return e,
        };
        let child = match registry_resolve(child) {
            Ok(c) => c,
            Err(e) => return e,
        };
        // cycle iff child is an ANCESTOR of parent: walk upward FROM PARENT
        let mut cursor = parent;
        loop {
            cursor = match (*cursor).parent {
                Some(p) => p,
                None => break,
            };
            if cursor == child {
                return TENUN_LAYOUT_ERR_TREE;
            }
        }
        // strict single-parent ownership: attached nodes cannot be re-attached
        if (*child).parent.is_some() {
            return TENUN_LAYOUT_ERR_TREE;
        }
        (*parent).children.push(child);
        (*child).parent = Some(parent);
        TENUN_LAYOUT_OK
    }))
    .unwrap_or(TENUN_LAYOUT_ERR_TREE)
}

#[no_mangle]
pub unsafe extern "C" fn tenun_layout_node_set_style(
    node: *mut NodeData,
    style: *const StyleC,
) -> i32 {
    catch_unwind(AssertUnwindSafe(|| {
        let _g = OpGuard::enter();
        if style.is_null() {
            return TENUN_LAYOUT_ERR_STYLE;
        }
        let node = match registry_resolve(node) {
            Ok(n) => n,
            Err(e) => return e,
        };
        let s = &*style;
        if !style_valid(s) {
            return TENUN_LAYOUT_ERR_STYLE;
        }
        (*node).style = *s;
        TENUN_LAYOUT_OK
    }))
    .unwrap_or(TENUN_LAYOUT_ERR_STYLE)
}

#[no_mangle]
pub unsafe extern "C" fn tenun_layout_node_set_measure(
    node: *mut NodeData,
    measure_fn: Option<MeasureFn>,
    userdata: *mut u8,
) {
    let outcome = catch_unwind(AssertUnwindSafe(|| {
        if let Ok(node) = registry_resolve(node) {
            (*node).measure = measure_fn.map(|func| MeasureHook { func, userdata });
        } // null/stale: no-op
    }));
    outcome.ok();
}

#[no_mangle]
pub unsafe extern "C" fn tenun_layout_compute(
    node: *mut NodeData,
    viewport_width: f32,
    viewport_height: f32,
) -> i32 {
    catch_unwind(AssertUnwindSafe(|| {
        let _g = OpGuard::enter();
        // explicit numeric-domain gate: never rely on engine panics for this
        if !(viewport_width.is_finite() && viewport_height.is_finite())
            || viewport_width < 0.0
            || viewport_height < 0.0
        {
            return TENUN_LAYOUT_ERR_TREE;
        }
        let node = match registry_resolve(node) {
            Ok(n) => n,
            Err(e) => return e,
        };
        if (*node).measure.is_some() {
            // parity with Yoga candidate: measured root rejected fail-closed
            return TENUN_LAYOUT_ERR_TREE;
        }
        let mut taffy = SpikeTree::new();
        taffy.disable_rounding();
        let mut registry = HashMap::new();
        match build_tree(&mut taffy, node, &mut registry) {
            Ok(root_id) => {
                let available = Size {
                    width: AvailableSpace::Definite(viewport_width),
                    height: AvailableSpace::Definite(viewport_height),
                };
                match taffy.compute_layout_with_measure(
                    root_id,
                    available,
                    |_known, space, _id, ctx, _style| {
                        let (hook, _) = match ctx.as_deref() {
                            Some(c) => (c.hook, 0u8),
                            None => {
                                return Size {
                                    width: 0.0,
                                    height: 0.0,
                                }
                            }
                        };
                        let mut out = BoxC {
                            x: 0.0,
                            y: 0.0,
                            width: 0.0,
                            height: 0.0,
                        };
                        let constraint = ConstraintC {
                            available_width: match space.width {
                                AvailableSpace::Definite(v) => v,
                                _ => f32::INFINITY,
                            },
                            available_height: match space.height {
                                AvailableSpace::Definite(v) => v,
                                _ => f32::INFINITY,
                            },
                        };
                        (hook.func)(hook.userdata, constraint, &mut out);
                        let (w, h) = sanitize_size(out.width, out.height);
                        Size {
                            width: w,
                            height: h,
                        }
                    },
                ) {
                    Ok(()) => {
                        store_results(&taffy, node, &registry);
                        TENUN_LAYOUT_OK
                    }
                    Err(_) => TENUN_LAYOUT_ERR_TREE,
                }
            }
            Err(e) => e,
        }
    }))
    .unwrap_or(TENUN_LAYOUT_ERR_TREE)
}

#[no_mangle]
pub unsafe extern "C" fn tenun_layout_result(node: *const NodeData) -> *const BoxC {
    match catch_unwind(AssertUnwindSafe(|| {
        let _g = OpGuard::enter();
        registry_resolve(node as *mut NodeData).map(|n| unsafe { &(*n).result })
    })) {
        Ok(Ok(r)) => r as *const BoxC,
        _ => std::ptr::null(),
    }
}
