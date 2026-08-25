use std::collections::HashMap;

use taffy::prelude::*;

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

fn dim(v: f32) -> Dimension {
    if v.is_nan() {
        Dimension::Auto
    } else {
        Dimension::Length(v)
    }
}

fn to_taffy_style(s: &StyleC) -> taffy::Style {
    taffy::Style {
        size: Size {
            width: dim(s.width),
            height: dim(s.height),
        },
        flex_grow: s.flex_grow,
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

pub struct MeasureCtx {
    pub width: f32,
    pub height: f32,
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
            if let Some((mw, mh)) = data.measure {
                taffy
                    .new_leaf_with_context(
                        style,
                        MeasureCtx {
                            width: mw,
                            height: mh,
                        },
                    )
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
                |_known, _space, _id, ctx, _style| Size {
                    width: ctx.as_deref().map(|c| c.width).unwrap_or(0.0),
                    height: ctx.as_deref().map(|c| c.height).unwrap_or(0.0),
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
}

#[no_mangle]
pub unsafe extern "C" fn tenun_layout_result(node: *const NodeData) -> *const BoxC {
    &(*node).result
}
