use std::cell::RefCell;
use std::collections::HashMap;

use yoga::{Align, FlexDirection, Gutter, Justify, MeasureMode, StyleUnit};

pub const TENUN_LAYOUT_OK: i32 = 0;
pub const TENUN_LAYOUT_ERR_STYLE: i32 = 1;
pub const TENUN_LAYOUT_ERR_TREE: i32 = 2;

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
    measured: &'a mut Vec<(*mut NodeData, usize, usize)>, // (arena_idx of measured leaf, its NodeData ptr key later filled after insert)
    hooks_added: &'a mut Vec<usize>,       // yoga raw refs registered during this build
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
    Box::into_raw(Box::new(NodeData::new()))
}

#[no_mangle]
pub unsafe extern "C" fn tenun_layout_node_destroy(node: *mut NodeData) {
    if !node.is_null() {
        drop(Box::from_raw(node));
    }
}

#[no_mangle]
pub unsafe extern "C" fn tenun_layout_node_add_child(
    parent: *mut NodeData,
    child: *mut NodeData,
) -> i32 {
    if parent.is_null() || child.is_null() || parent == child {
        return TENUN_LAYOUT_ERR_TREE;
    }
    let mut cursor = child;
    while let Some(p) = (*cursor).parent {
        if p == parent {
            return TENUN_LAYOUT_ERR_TREE; // cycle
        }
        cursor = p;
    }
    (*parent).children.push(child);
    (*child).parent = Some(parent);
    TENUN_LAYOUT_OK
}

#[no_mangle]
pub unsafe extern "C" fn tenun_layout_node_set_style(
    node: *mut NodeData,
    style: *const StyleC,
) -> i32 {
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
}

#[no_mangle]
pub unsafe extern "C" fn tenun_layout_node_set_measure(
    node: *mut NodeData,
    measure_fn: Option<MeasureFn>,
    userdata: *mut u8,
) {
    (*node).measure = measure_fn.map(|func| MeasureHook { func, userdata });
}

#[no_mangle]
pub unsafe extern "C" fn tenun_layout_compute(
    node: *mut NodeData,
    viewport_width: f32,
    viewport_height: f32,
) -> i32 {
    if node.is_null() {
        return TENUN_LAYOUT_ERR_TREE;
    }
    let mut arena: Arena = Vec::new();
    let mut pairs: Vec<(usize, *mut NodeData)> = Vec::new();
    let mut measured: Vec<(*mut NodeData, usize, usize)> = Vec::new();
    let mut hooks_added: Vec<usize> = Vec::new();
    {
        let mut bx = BuildCtx {
            arena: &mut arena,
            pairs: &mut pairs,
            measured: &mut measured,
            hooks_added: &mut hooks_added,
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
    &(*node).result
}
