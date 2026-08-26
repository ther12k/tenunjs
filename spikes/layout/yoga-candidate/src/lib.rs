// FFI spike scope: full per-fn # Safety sections arrive with the production
// engine surface (M2+); cross-boundary rules live in the contract doc beside
// each header.
#![allow(clippy::missing_safety_doc)]
use std::cell::RefCell;
use std::collections::HashMap;
use std::panic::{catch_unwind, AssertUnwindSafe};

use yoga::{Align, FlexDirection, Gutter, Justify, MeasureMode, StyleUnit};

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

#[repr(C)]
#[derive(Clone, Copy)]
pub struct ConstraintC {
    pub available_width: f32,
    pub available_height: f32,
}

pub type MeasureFn = extern "C" fn(userdata: *mut u8, constraint: ConstraintC, out: *mut BoxC);

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

fn unit(v: f32) -> StyleUnit {
    if v.is_nan() {
        StyleUnit::UndefinedValue
    } else {
        StyleUnit::Point(v.into())
    }
}

// ---- opaque handle registry (H1): slot + generation -------------------------
//
// The `tenun_layout_node*` values crossing the ABI are NOT pointers into the
// node; they encode (slot, generation). destroy() bumps the slot's
// generation, so use-after-destroy and double-destroy fail closed with
// ERR_HANDLE instead of reaching freed memory. Slots recycle; a
// (slot, generation) pair is never reissued. The spike layout contract is
// single-threaded: the registry is thread-local, so handles presented on the
// wrong thread resolve as stale (fail-closed, no undefined behavior).
struct NodeSlot {
    generation: u32,
    node: Option<Box<NodeData>>,
}

struct NodeRegistry {
    slots: Vec<NodeSlot>,
    free: Vec<u32>,
}

thread_local! {
    static NODE_REGISTRY: RefCell<NodeRegistry> = const {
        RefCell::new(NodeRegistry {
            slots: Vec::new(),
            free: Vec::new(),
        })
    };
}

const HANDLE_GEN_SHIFT: u64 = 32;

fn encode_handle(slot: u32, generation: u32) -> *mut NodeData {
    (((generation as u64) << HANDLE_GEN_SHIFT) | (slot as u64 + 1)) as *mut NodeData
}

fn decode_handle(handle: *mut NodeData) -> Option<(u32, u32)> {
    if handle.is_null() {
        return None;
    }
    let bits = handle as usize as u64;
    let slot = (bits & 0xFFFF_FFFF).checked_sub(1)? as u32;
    Some((slot, (bits >> HANDLE_GEN_SHIFT) as u32))
}

fn registry_insert(node: NodeData) -> *mut NodeData {
    NODE_REGISTRY.with(|r| {
        let mut reg = r.borrow_mut();
        match reg.free.pop() {
            Some(slot) => {
                let s = &mut reg.slots[slot as usize];
                s.node = Some(Box::new(node));
                encode_handle(slot, s.generation)
            }
            None => {
                reg.slots.push(NodeSlot {
                    generation: 1,
                    node: Some(Box::new(node)),
                });
                let slot = (reg.slots.len() - 1) as u32;
                encode_handle(slot, 1)
            }
        }
    })
}

/// Stale handles (destroyed, forged, or wrong-thread) fail closed with
/// ERR_HANDLE; the node pointer is only ever derived from a validated slot.
fn registry_resolve(handle: *mut NodeData) -> Result<*mut NodeData, i32> {
    let (slot, generation) = match decode_handle(handle) {
        Some(pair) => pair,
        None => return Err(TENUN_LAYOUT_ERR_TREE), // null handle keeps legacy code
    };
    NODE_REGISTRY.with(|r| {
        let reg = r.borrow();
        match reg.slots.get(slot as usize) {
            Some(s) if s.generation == generation && s.node.is_some() => {
                Ok(s.node.as_ref().unwrap().as_ref() as *const NodeData as *mut NodeData)
            }
            _ => Err(TENUN_LAYOUT_ERR_HANDLE),
        }
    })
}

thread_local! {
    static MEASURE_HOOKS: RefCell<HashMap<usize, MeasureHook>> = RefCell::new(HashMap::new());
}

fn mode_to_available(v: f32, mode: MeasureMode) -> f32 {
    match mode {
        MeasureMode::Exactly | MeasureMode::AtMost => v,
        _ => f32::INFINITY,
    }
}

extern "C" fn spike_measure(
    node: yoga::NodeRef,
    w: f32,
    wm: MeasureMode,
    h: f32,
    hm: MeasureMode,
) -> yoga::Size {
    let hook = MEASURE_HOOKS.with(|m| m.borrow().get(&(node as usize)).copied());
    match hook {
        Some(hook) => {
            let constraint = ConstraintC {
                available_width: mode_to_available(w, wm),
                available_height: mode_to_available(h, hm),
            };
            let mut out = BoxC {
                x: 0.0,
                y: 0.0,
                width: 0.0,
                height: 0.0,
            };
            (hook.func)(hook.userdata, constraint, &mut out);
            yoga::Size {
                width: out.width,
                height: out.height,
            }
        }
        None => yoga::Size {
            width: 0.0,
            height: 0.0,
        },
    }
}

unsafe fn apply_style(node: &mut yoga::Node, s: &StyleC) -> Result<(), i32> {
    if !(s.flex_grow >= 0.0 && s.gap >= 0.0 && s.padding >= 0.0)
        || s.direction > 1
        || s.justify_content > 1
        || s.align_items > 1
    {
        return Err(TENUN_LAYOUT_ERR_STYLE);
    }
    node.set_flex_direction(match s.direction {
        1 => FlexDirection::Column,
        _ => FlexDirection::Row,
    });
    node.set_justify_content(match s.justify_content {
        1 => Justify::Center,
        _ => Justify::FlexStart,
    });
    node.set_align_items(match s.align_items {
        1 => Align::Center,
        _ => Align::Stretch,
    });
    node.set_flex_grow(s.flex_grow);
    node.set_flex_shrink(0.0);
    node.set_width(unit(s.width));
    node.set_height(unit(s.height));
    node.set_gap(Gutter::Column, unit(s.gap));
    node.set_gap(Gutter::Row, unit(s.gap));
    node.set_padding(yoga::Edge::All, unit(s.padding));
    Ok(())
}

type Arena = Vec<Box<yoga::Node>>;

struct BuildCtx<'a> {
    arena: &'a mut Arena,
    pairs: &'a mut Vec<(usize, *mut NodeData)>,
    // (leaf node ptr, parent arena idx, position under parent)
    measured: &'a mut Vec<(*mut NodeData, usize, usize)>,
}

unsafe fn build_all(
    node: *mut NodeData,
    bx: &mut BuildCtx,
    parent_arena_idx: Option<(usize, usize)>,
) -> Result<usize, i32> {
    let data = &mut *node;
    let mut ynode = Box::new(yoga::Node::new());
    apply_style(&mut ynode, &data.style)?;
    let is_measured_leaf = data.children.is_empty() && data.measure.is_some();
    if is_measured_leaf {
        ynode.set_measure_func(Some(spike_measure));
    }
    bx.arena.push(ynode);
    let self_idx = bx.arena.len() - 1;
    bx.pairs.push((self_idx, node));
    for (i, &c) in data.children.iter().enumerate() {
        let child_idx = build_all(c, bx, Some((self_idx, i)))?;
        let (parent, child) = if self_idx < child_idx {
            let (left, right) = bx.arena.split_at_mut(child_idx);
            (&mut left[self_idx], &mut right[0])
        } else {
            let (left, right) = bx.arena.split_at_mut(self_idx);
            (&mut right[0], &mut left[child_idx])
        };
        parent.insert_child(child, i);
    }
    if is_measured_leaf {
        match parent_arena_idx {
            Some((pidx, pos)) => bx.measured.push((node, pidx, pos)),
            None => return Err(TENUN_LAYOUT_ERR_TREE), // measured root unsupported in spike
        }
    }
    Ok(self_idx)
}

fn store_results(arena: &Arena, pairs: &[(usize, *mut NodeData)]) {
    for &(idx, node) in pairs {
        unsafe {
            let layout = arena[idx].get_layout();
            (*node).result = BoxC {
                x: layout.left(),
                y: layout.top(),
                width: layout.width(),
                height: layout.height(),
            };
        }
    }
}

#[no_mangle]
pub extern "C" fn tenun_layout_node_create() -> *mut NodeData {
    catch_unwind(AssertUnwindSafe(|| registry_insert(NodeData::new())))
        .unwrap_or(std::ptr::null_mut())
}

#[no_mangle]
pub unsafe extern "C" fn tenun_layout_node_destroy(node: *mut NodeData) {
    let outcome = catch_unwind(AssertUnwindSafe(|| {
        let (slot, generation) = match decode_handle(node) {
            Some(pair) => pair,
            None => return, // null / double destroy: safe no-op
        };
        NODE_REGISTRY.with(|r| {
            let mut reg = r.borrow_mut();
            let live = reg
                .slots
                .get(slot as usize)
                .is_some_and(|s| s.generation == generation && s.node.is_some());
            if !live {
                return; // stale handle: no-op, never a double free
            }
            let mut boxed = reg.slots[slot as usize].node.take().unwrap();
            let raw = boxed.as_mut() as *mut NodeData;
            // lifecycle: detach from parent so no dangling entry survives
            if let Some(par) = boxed.parent.take() {
                (*par).children.retain(|&c| c != raw);
            }
            // children become unparented roots; their parent links are cleared
            for &c in &boxed.children {
                if !c.is_null() {
                    (*c).parent = None;
                }
            }
            drop(boxed);
            reg.slots[slot as usize].generation += 1; // handle never validates again
            reg.free.push(slot);
        });
    }));
    outcome.ok(); // panic containment: destroy never unwinds across the ABI
}

#[no_mangle]
pub unsafe extern "C" fn tenun_layout_node_add_child(
    parent: *mut NodeData,
    child: *mut NodeData,
) -> i32 {
    catch_unwind(AssertUnwindSafe(|| {
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
        if style.is_null() {
            return TENUN_LAYOUT_ERR_STYLE;
        }
        let node = match registry_resolve(node) {
            Ok(n) => n,
            Err(e) => return e,
        };
        let s = &*style;
        if !(s.flex_grow >= 0.0 && s.gap >= 0.0 && s.padding >= 0.0)
            || s.direction > 1
            || s.justify_content > 1
            || s.align_items > 1
        {
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
        let node = match registry_resolve(node) {
            Ok(n) => n,
            Err(e) => return e,
        };
        let mut arena: Arena = Vec::new();
        let mut pairs: Vec<(usize, *mut NodeData)> = Vec::new();
        let mut measured: Vec<(*mut NodeData, usize, usize)> = Vec::new();
        let mut hooks_added: Vec<usize> = Vec::new();
        {
            let mut bx = BuildCtx {
                arena: &mut arena,
                pairs: &mut pairs,
                measured: &mut measured,
            };
            match build_all(node, &mut bx, None) {
                Ok(root_idx) => {
                    if (*node).measure.is_some() {
                        // fail closed on measured root rather than mis-measure
                        cleanup_hooks(&hooks_added);
                        return TENUN_LAYOUT_ERR_TREE;
                    }
                    let mut reg_fail = false;
                    for &(leaf_ptr, pidx, pos) in measured.iter() {
                        let hook = (*leaf_ptr).measure.unwrap();
                        let raw = arena[pidx].get_child(pos) as usize;
                        if raw == 0 {
                            reg_fail = true;
                            break;
                        }
                        MEASURE_HOOKS.with(|m| {
                            m.borrow_mut().insert(raw, hook);
                        });
                        hooks_added.push(raw);
                    }
                    if reg_fail {
                        cleanup_hooks(&hooks_added);
                        return TENUN_LAYOUT_ERR_TREE;
                    }
                    arena[root_idx].calculate_layout(
                        viewport_width,
                        viewport_height,
                        yoga::Direction::LTR,
                    );
                    store_results(&arena, &pairs);
                    cleanup_hooks(&hooks_added);
                    TENUN_LAYOUT_OK
                }
                Err(e) => {
                    cleanup_hooks(&hooks_added);
                    e
                }
            }
        }
    }))
    .unwrap_or(TENUN_LAYOUT_ERR_TREE)
}

fn cleanup_hooks(keys: &[usize]) {
    MEASURE_HOOKS.with(|m| {
        let mut map = m.borrow_mut();
        for k in keys {
            map.remove(k);
        }
    });
}

#[no_mangle]
pub unsafe extern "C" fn tenun_layout_result(node: *const NodeData) -> *const BoxC {
    match catch_unwind(AssertUnwindSafe(|| {
        registry_resolve(node as *mut NodeData).map(|n| unsafe { &(*n).result })
    })) {
        Ok(Ok(r)) => r as *const BoxC,
        _ => std::ptr::null(),
    }
}
