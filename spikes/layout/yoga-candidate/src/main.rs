use std::fs;

use serde::Deserialize;
use tenun_layout_yoga::{
    tenun_layout_compute, tenun_layout_node_add_child, tenun_layout_node_create,
    tenun_layout_node_set_measure, tenun_layout_node_set_style, tenun_layout_result, BoxC,
    ConstraintC, NodeData, StyleC, TENUN_LAYOUT_OK,
};

#[derive(Deserialize)]
struct Case {
    viewport: Viewport,
    root: JsonNode,
    expected: Vec<ExpBox>,
}

#[derive(Deserialize)]
struct Viewport {
    width: f32,
    height: f32,
}

#[derive(Deserialize)]
struct JsonNode {
    style: JsonStyle,
    #[serde(default)]
    measure: Option<MeasureStub>,
    #[serde(default)]
    children: Vec<JsonNode>,
}

#[derive(Deserialize)]
struct JsonStyle {
    width: Option<f32>,
    height: Option<f32>,
    #[serde(default)]
    flex_grow: Option<f32>,
    #[serde(default)]
    direction: Option<String>,
    #[serde(default)]
    gap: Option<f32>,
    #[serde(default)]
    padding: Option<f32>,
    #[serde(default)]
    justify_content: Option<String>,
    #[serde(default)]
    align_items: Option<String>,
}

#[derive(Deserialize)]
struct MeasureStub {
    width: f32,
    height: f32,
}

#[derive(Deserialize)]
struct ExpBox {
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}

fn tuple(b: &ExpBox) -> (f64, f64, f64, f64) {
    (b.x, b.y, b.width, b.height)
}

fn box_tuple(b: &BoxC) -> (f64, f64, f64, f64) {
    (b.x as f64, b.y as f64, b.width as f64, b.height as f64)
}

use std::cell::RefCell;
thread_local! {
    static MEASURE_SLOTS: RefCell<Vec<[f64; 2]>> = const { RefCell::new(Vec::new()) };
}

extern "C" fn stub_measure(userdata: *mut u8, _c: ConstraintC, out: *mut BoxC) {
    unsafe {
        let slot = &*(userdata as *const [f64; 2]);
        (*out).width = slot[0] as f32;
        (*out).height = slot[1] as f32;
    }
}

// mirror of the JSON tree carrying only ABI handles — internals are never
// reachable through the adapter surface
struct Built {
    handle: *mut NodeData,
    children: Vec<Built>,
}

unsafe fn build(node: &JsonNode) -> Built {
    let n = tenun_layout_node_create();
    let style = StyleC {
        width: node.style.width.unwrap_or(f32::NAN),
        height: node.style.height.unwrap_or(f32::NAN),
        flex_grow: node.style.flex_grow.unwrap_or(0.0),
        direction: if node.style.direction.as_deref() == Some("column") {
            1
        } else {
            0
        },
        gap: node.style.gap.unwrap_or(0.0),
        padding: node.style.padding.unwrap_or(0.0),
        justify_content: if node.style.justify_content.as_deref() == Some("center") {
            1
        } else {
            0
        },
        align_items: if node.style.align_items.as_deref() == Some("center") {
            1
        } else {
            0
        },
    };
    assert_eq!(tenun_layout_node_set_style(n, &style), TENUN_LAYOUT_OK);
    if let Some(m) = &node.measure {
        MEASURE_SLOTS.with(|slots| {
            slots.borrow_mut().push([m.width as f64, m.height as f64]);
            let ptr = slots.borrow().last().unwrap().as_ptr() as *mut u8;
            tenun_layout_node_set_measure(n, Some(stub_measure), ptr);
        });
    }
    let children: Vec<Built> = node.children.iter().map(|c| build(c)).collect();
    for c in &children {
        tenun_layout_node_add_child(n, c.handle);
    }
    Built {
        handle: n,
        children,
    }
}

unsafe fn collect(b: &Built, out: &mut Vec<BoxC>) {
    out.push(*tenun_layout_result(b.handle));
    for c in &b.children {
        collect(c, out);
    }
}

unsafe fn run_case(path: &std::path::Path) -> Result<(), String> {
    let case: Case = serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap();
    let built = build(&case.root);
    let status = tenun_layout_compute(built.handle, case.viewport.width, case.viewport.height);
    if status != TENUN_LAYOUT_OK {
        return Err(format!("compute status {}", status));
    }
    let mut all = Vec::new();
    collect(&built, &mut all);
    let actual: Vec<(f64, f64, f64, f64)> = all[1..].iter().map(box_tuple).collect();
    let expected: Vec<(f64, f64, f64, f64)> = case.expected.iter().map(tuple).collect();
    if actual != expected {
        return Err(format!("expected {:?}\n  actual   {:?}", expected, actual));
    }
    Ok(())
}

fn main() {
    let dir = std::path::Path::new("../corpus");
    let mut paths: Vec<_> = fs::read_dir(dir)
        .expect("corpus dir")
        .map(|e| e.unwrap().path())
        .filter(|p| p.extension().is_some_and(|e| e == "json"))
        .collect();
    paths.sort();

    let mut failures = 0;
    unsafe {
        for path in &paths {
            match run_case(path) {
                Ok(()) => println!("PASS {}", path.display()),
                Err(e) => {
                    println!("FAIL {}\n  {}", path.display(), e);
                    failures += 1;
                }
            }
        }

        println!("== incremental mutation check ==");
        let root_style = StyleC {
            width: 300.0,
            height: 100.0,
            flex_grow: 0.0,
            direction: 0,
            gap: 0.0,
            padding: 0.0,
            justify_content: 0,
            align_items: 0,
        };
        let child_style = StyleC {
            width: 0.0,
            height: 0.0,
            flex_grow: 1.0,
            direction: 0,
            gap: 0.0,
            padding: 0.0,
            justify_content: 0,
            align_items: 0,
        };
        let root = tenun_layout_node_create();
        let c0 = tenun_layout_node_create();
        let c1 = tenun_layout_node_create();
        assert_eq!(
            tenun_layout_node_set_style(root, &root_style),
            TENUN_LAYOUT_OK
        );
        assert_eq!(
            tenun_layout_node_set_style(c0, &child_style),
            TENUN_LAYOUT_OK
        );
        assert_eq!(
            tenun_layout_node_set_style(c1, &child_style),
            TENUN_LAYOUT_OK
        );
        tenun_layout_node_add_child(root, c0);
        tenun_layout_node_add_child(root, c1);
        assert_eq!(tenun_layout_compute(root, 300.0, 100.0), TENUN_LAYOUT_OK);

        let grown = StyleC {
            flex_grow: 2.0,
            ..child_style
        };
        assert_eq!(tenun_layout_node_set_style(c0, &grown), TENUN_LAYOUT_OK);
        assert_eq!(tenun_layout_compute(root, 300.0, 100.0), TENUN_LAYOUT_OK);
        let widths = (
            (*tenun_layout_result(c0)).width as f64,
            (*tenun_layout_result(c1)).width as f64,
        );
        if widths == (200.0, 100.0) {
            println!("PASS incremental grow redistribution");
        } else {
            println!("FAIL incremental: want (200.0, 100.0) got {:?}", widths);
            failures += 1;
        }
    }

    if failures > 0 {
        std::process::exit(1);
    }
}
