use std::cell::RefCell;

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

pub struct NodeData {
    pub style: StyleC,
    pub measure: Option<(f32, f32)>,
    pub children: Vec<*mut NodeData>,
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
    static MEASURE_STACK: RefCell<Vec<(f32, f32)>> = const { RefCell::new(Vec::new()) };
}

extern "C" fn spike_measure(
    _node: yoga::NodeRef,
    _w: f32,
    _wm: MeasureMode,
    _h: f32,
    _hm: MeasureMode,
) -> yoga::Size {
    MEASURE_STACK.with(|m| {
        let (mw, mh) = m.borrow().last().copied().unwrap_or((0.0, 0.0));
        yoga::Size {
            width: mw,
            height: mh,
        }
    })
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

unsafe fn build_all(
    node: *mut NodeData,
    arena: &mut Arena,
    pairs: &mut Vec<(usize, *mut NodeData)>,
) -> Result<usize, i32> {
    let data = &mut *node;
    let mut ynode = Box::new(yoga::Node::new());
    apply_style(&mut ynode, &data.style)?;
    if data.children.is_empty() {
        if let Some((w, h)) = data.measure {
            MEASURE_STACK.with(|m| m.borrow_mut().push((w, h)));
            ynode.set_measure_func(Some(spike_measure));
        }
    }
    arena.push(ynode);
    let self_idx = arena.len() - 1;
    pairs.push((self_idx, node));
    for (i, &c) in data.children.iter().enumerate() {
        let child_idx = build_all(c, arena, pairs)?;
        let (parent, child) = if self_idx < child_idx {
            let (left, right) = arena.split_at_mut(child_idx);
            (&mut left[self_idx], &mut right[0])
        } else {
            let (left, right) = arena.split_at_mut(self_idx);
            (&mut right[0], &mut left[child_idx])
        };
        parent.insert_child(child, i);
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
pub unsafe extern "C" fn tenun_layout_node_add_child(parent: *mut NodeData, child: *mut NodeData) {
    (*parent).children.push(child);
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
    width: f32,
    height: f32,
) {
    (*node).measure = Some((width, height));
}

#[no_mangle]
pub unsafe extern "C" fn tenun_layout_compute(
    node: *mut NodeData,
    viewport_width: f32,
    viewport_height: f32,
) -> i32 {
    let mut arena: Arena = Vec::new();
    let mut pairs: Vec<(usize, *mut NodeData)> = Vec::new();
    match build_all(node, &mut arena, &mut pairs) {
        Ok(root_idx) => {
            arena[root_idx].calculate_layout(viewport_width, viewport_height, yoga::Direction::LTR);
            store_results(&arena, &pairs);
            MEASURE_STACK.with(|m| m.borrow_mut().clear());
            TENUN_LAYOUT_OK
        }
        Err(e) => e,
    }
}

#[no_mangle]
pub unsafe extern "C" fn tenun_layout_result(node: *const NodeData) -> *const BoxC {
    &(*node).result
}
