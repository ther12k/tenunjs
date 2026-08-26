// FFI spike scope: full per-fn # Safety sections arrive with the production
// engine surface (M2+); cross-boundary rules live in the contract doc beside
// each header.
#![allow(clippy::missing_safety_doc)]
use std::cell::RefCell;
use std::collections::HashMap;
use std::panic::{catch_unwind, AssertUnwindSafe};

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
    s.flex_grow >= 0.0
        && s.gap >= 0.0
        && s.padding >= 0.0
        && valid_dim(s.width)
        && valid_dim(s.height)
        && s.direction <= 1
        && s.justify_content <= 1
        && s.align_items <= 1
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
                        Size {
                            width: out.width,
                            height: out.height,
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
        registry_resolve(node as *mut NodeData).map(|n| unsafe { &(*n).result })
    })) {
        Ok(Ok(r)) => r as *const BoxC,
        _ => std::ptr::null(),
    }
}
