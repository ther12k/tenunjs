use std::fs;

use serde::Deserialize;
use tenun_layout_yoga::{
    StyleC,
    tenun_layout_compute, tenun_layout_node_add_child, tenun_layout_node_create,
    tenun_layout_node_set_measure, tenun_layout_node_set_style, tenun_layout_result, BoxC,
    NodeData, TENUN_LAYOUT_OK,
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
    (b.x as f64, b.y as f64, b.width as f64, b.height as f64)
}

fn box_tuple(b: &BoxC) -> (f64, f64, f64, f64) {
    (b.x as f64, b.y as f64, b.width as f64, b.height as f64)
}

unsafe fn build(node: &JsonNode) -> *mut NodeData {
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
        tenun_layout_node_set_measure(n, m.width, m.height);
    }
    for child in &node.children {
        tenun_layout_node_add_child(n, build(child));
    }
    n
}

unsafe fn collect(node: *const NodeData, out: &mut Vec<BoxC>) {
    out.push(*tenun_layout_result(node));
    let n = node as *mut NodeData;
    for i in 0..(*n).children.len() {
        let child = *(&(*n).children).get(i).unwrap();
        collect(child, out);
    }
}

unsafe fn run_case(path: &std::path::Path) -> Result<(), String> {
    let case: Case = serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap();
    let root = build(&case.root);
    let status = tenun_layout_compute(root, case.viewport.width, case.viewport.height);
    if status != TENUN_LAYOUT_OK {
        return Err(format!("compute status {}", status));
    }
    let mut all = Vec::new();
    collect(root as *const NodeData, &mut all);
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
        .filter(|p| p.extension().map_or(false, |e| e == "json"))
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
        let mut boxes = Vec::new();
        collect(root as *const NodeData, &mut boxes);
        let widths = (boxes[1].width as f64, boxes[2].width as f64);
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
