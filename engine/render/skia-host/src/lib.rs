//! Framework-owned Skia rasterizer for display-list scenes v1
//! (ADR-0026 stage 2, TN-182).
//!
//! This crate paints the EXACT scene wire contract the TypeScript
//! lowering emits (`layoutScreen`) through skia-safe — the same op set,
//! coordinate model (design units; `Text.y` is the baseline), scroll
//! semantics (nested content space), and fail-visible rules the browser
//! host and the Android Canvas painter already honor. It is the first
//! rendering path the framework owns end to end: no platform Canvas, no
//! WebView — Skia directly.
//!
//! Stage scope (deliberate): CPU rasterization into an RGBA8 buffer and
//! a C ABI entry point for the future Android surface integration.
//! GPU surfaces and the dedicated render thread are later stages.
//!
//! Known gap: `shadow` (elevation) values are not painted yet —
//! elevation rendering moves to Skia image filters with the GPU stage
//! (documented in ADR-0026).

use std::os::raw::{c_char, c_int};

use skia_safe::{
    gradient_shader, AlphaType, BlendMode, Canvas, Color4f, ColorType, Font, FontMgr, ISize,
    ImageInfo, Paint, PaintStyle, Point, RRect, Rect, TileMode, Typeface, Vector,
};

// ---------------------------------------------------------------------------
// Wire model (serde twin of the TypeScript DisplayListScene, ops only —
// taps/transition/semantics are host concerns, not paint)
// ---------------------------------------------------------------------------

#[derive(Debug, serde::Deserialize)]
struct Scene {
    #[serde(rename = "tenun")]
    marker: String,
    version: u32,
    #[serde(default)]
    #[serde(rename = "designWidth")]
    design_width: f32,
    #[serde(default)]
    background: String,
    ops: Vec<Op>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(tag = "op", rename_all = "kebab-case")]
enum Op {
    Rect {
        x: f32,
        y: f32,
        w: f32,
        h: f32,
        #[serde(default)]
        r: f32,
        color: String,
        #[serde(default)]
        #[serde(rename = "colorTo")]
        color_to: Option<String>,
    },
    Outline {
        x: f32,
        y: f32,
        w: f32,
        h: f32,
        r: f32,
        color: String,
        width: f32,
    },
    Text {
        x: f32,
        y: f32,
        text: String,
        size: f32,
        #[serde(default = "default_weight")]
        weight: i32,
        color: String,
    },
    Circle {
        #[serde(rename = "cx")]
        cx: f32,
        #[serde(rename = "cy")]
        cy: f32,
        r: f32,
        color: String,
    },
    Ring {
        #[serde(rename = "cx")]
        cx: f32,
        #[serde(rename = "cy")]
        cy: f32,
        r: f32,
        width: f32,
        color: String,
        #[serde(default)]
        progress: f32,
        #[serde(default)]
        track: Option<String>,
    },
    Line {
        #[serde(rename = "x1")]
        x1: f32,
        #[serde(rename = "y1")]
        y1: f32,
        #[serde(rename = "x2")]
        x2: f32,
        #[serde(rename = "y2")]
        y2: f32,
        color: String,
        width: f32,
    },
    Gradient {
        x: f32,
        y: f32,
        w: f32,
        h: f32,
        r: f32,
        color: String,
        #[serde(rename = "colorTo")]
        color_to: String,
    },
    /// Accepted (the wire carries it) but painted by the host's input
    /// layer, not the painter — the visible field content arrives as
    /// separate text/rect ops, exactly like the other hosts.
    TextInput {
        #[allow(dead_code)]
        id: String,
    },
    ScrollRegion {
        #[allow(dead_code)]
        id: String,
        x: f32,
        y: f32,
        w: f32,
        h: f32,
        ops: Vec<NestedOp>,
    },
}

#[derive(Debug, serde::Deserialize)]
#[serde(tag = "op", rename_all = "kebab-case")]
enum NestedOp {
    Rect {
        x: f32,
        y: f32,
        w: f32,
        h: f32,
        #[serde(default)]
        r: f32,
        color: String,
    },
    Text {
        x: f32,
        y: f32,
        text: String,
        size: f32,
        color: String,
    },
}

fn default_weight() -> i32 {
    400
}

#[derive(Debug)]
pub struct RenderError(pub String);

impl std::fmt::Display for RenderError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "skia render: {}", self.0)
    }
}

impl std::error::Error for RenderError {}

// ---------------------------------------------------------------------------
// Color parsing: the wire's #rrggbb literals
// ---------------------------------------------------------------------------

fn parse_color(value: &str, where_: &str) -> Result<Color4f, RenderError> {
    let hex = value.strip_prefix('#').ok_or_else(|| {
        RenderError(format!(
            "{where_}: color \"{value}\" is not a #rrggbb literal"
        ))
    })?;
    if hex.len() != 6 || !hex.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(RenderError(format!(
            "{where_}: color \"{value}\" is not a #rrggbb literal"
        )));
    }
    let channel = |range: std::ops::Range<usize>| {
        u8::from_str_radix(&hex[range], 16).expect("validated hex digit") as f32 / 255.0
    };
    Ok(Color4f::new(
        channel(0..2),
        channel(2..4),
        channel(4..6),
        1.0,
    ))
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/// Renders a display-list scene (design units) into an RGBA8 buffer of
/// `width` × `height` device pixels, scaling designWidth to the surface
/// width (the hosts' `dlScale` rule). Returns the pixel buffer or a
/// fail-visible error: unknown ops, malformed colors, scene-version
/// violations — never a partial frame.
pub fn render_scene(scene_json: &str, width: i32, height: i32) -> Result<Vec<u8>, RenderError> {
    if width <= 0 || height <= 0 {
        return Err(RenderError(format!("invalid surface {width}x{height}")));
    }
    let scene: Scene =
        serde_json::from_str(scene_json).map_err(|e| RenderError(format!("scene parse: {e}")))?;
    if scene.marker != "display-list" {
        return Err(RenderError(format!(
            "not a display-list scene (tenun=\"{}\")",
            scene.marker
        )));
    }
    if scene.version != 1 {
        return Err(RenderError(format!(
            "scene version {} exceeds renderer support (1)",
            scene.version
        )));
    }

    let mut surface = skia_safe::surfaces::raster_n32_premul(ISize::new(width, height))
        .ok_or_else(|| RenderError("could not allocate Skia surface".into()))?;
    let canvas = surface.canvas();
    canvas.clear(parse_color(&scene.background, "background")?);

    let scale = if scene.design_width > 0.0 {
        width as f32 / scene.design_width
    } else {
        1.0
    };
    let typeface = default_typeface()?;
    let fonts = Fonts {
        regular: Font::from_typeface(typeface.clone(), 18.0),
        bold: Font::from_typeface(typeface, 18.0),
    };

    canvas.save();
    canvas.scale((scale, scale));
    for op in &scene.ops {
        paint_root_op(canvas, op, &fonts)?;
    }
    canvas.restore();

    let info = ImageInfo::new(
        ISize::new(width, height),
        ColorType::RGBA8888,
        AlphaType::Premul,
        None,
    );
    let mut pixels = vec![0u8; (width * height * 4) as usize];
    let ok = surface.read_pixels(&info, &mut pixels, (width * 4) as usize, (0, 0));
    if !ok {
        return Err(RenderError("pixel readback failed".into()));
    }
    Ok(pixels)
}

struct Fonts {
    regular: Font,
    bold: Font,
}

fn default_typeface() -> Result<Typeface, RenderError> {
    FontMgr::default()
        .legacy_make_typeface(None, skia_safe::FontStyle::normal())
        .ok_or_else(|| RenderError("no system typeface available for text rendering".into()))
}

fn paint_root_op(canvas: &Canvas, op: &Op, fonts: &Fonts) -> Result<(), RenderError> {
    match op {
        Op::TextInput { .. } => Ok(()),
        Op::ScrollRegion {
            x, y, w, h, ops, ..
        } => {
            // The TN-161 rule: the viewport box clips, content paints in
            // its own coordinate space (the host applies its scroll offset
            // before calling; this renderer is given settled offsets).
            canvas.save();
            canvas.clip_rect(
                Rect::from_xywh(*x, *y, *w, *h),
                skia_safe::ClipOp::Intersect,
                true,
            );
            canvas.translate((*x, *y));
            for nested in ops {
                paint_nested_op(canvas, nested, fonts)?;
            }
            canvas.restore();
            Ok(())
        }
        Op::Rect {
            x,
            y,
            w,
            h,
            r,
            color,
            color_to,
        } => {
            let mut paint = fill_paint(parse_color(color, "rect.color")?);
            if let Some(to) = color_to {
                let colors = [
                    parse_color(color, "rect.color")?,
                    parse_color(to, "rect.colorTo")?,
                ];
                let shader = gradient_shader::linear(
                    (Point::new(*x, *y), Point::new(*x, *y + *h)),
                    colors.as_slice(),
                    None,
                    TileMode::Clamp,
                    None,
                    None,
                )
                .ok_or_else(|| RenderError("gradient shader creation failed".into()))?;
                paint.set_shader(shader);
            }
            canvas.draw_rrect(rrect(*x, *y, *w, *h, *r), &paint);
            Ok(())
        }
        Op::Gradient {
            x,
            y,
            w,
            h,
            r,
            color,
            color_to,
        } => {
            let colors = [
                parse_color(color, "gradient.color")?,
                parse_color(color_to, "gradient.colorTo")?,
            ];
            let shader = gradient_shader::linear(
                (Point::new(*x, *y), Point::new(*x, *y + *h)),
                colors.as_slice(),
                None,
                TileMode::Clamp,
                None,
                None,
            )
            .ok_or_else(|| RenderError("gradient shader creation failed".into()))?;
            let mut paint = fill_paint(Color4f::new(0.0, 0.0, 0.0, 1.0));
            paint.set_shader(shader);
            canvas.draw_rrect(rrect(*x, *y, *w, *h, *r), &paint);
            Ok(())
        }
        Op::Outline {
            x,
            y,
            w,
            h,
            r,
            color,
            width,
        } => {
            let paint = stroke_paint(parse_color(color, "outline.color")?, *width);
            canvas.draw_rrect(rrect(*x, *y, *w, *h, *r), &paint);
            Ok(())
        }
        Op::Text {
            x,
            y,
            text,
            size,
            weight,
            color,
        } => {
            let mut font = if *weight >= 600 {
                fonts.bold.clone()
            } else {
                fonts.regular.clone()
            };
            font.set_size(*size);
            let paint = fill_paint(parse_color(color, "text.color")?);
            canvas.draw_str(text, (*x, *y), &font, &paint);
            Ok(())
        }
        Op::Circle { cx, cy, r, color } => {
            canvas.draw_circle(
                (*cx, *cy),
                *r,
                &fill_paint(parse_color(color, "circle.color")?),
            );
            Ok(())
        }
        Op::Ring {
            cx,
            cy,
            r,
            width,
            color,
            progress,
            track,
        } => {
            let stroke = *width;
            let outer = r - stroke / 2.0;
            if outer <= 0.0 {
                return Ok(());
            }
            let bounds = Rect::from_ltrb(cx - outer, cy - outer, cx + outer, cy + outer);
            // Track: the full circle under the arc.
            if let Some(track_color) = track {
                let track_paint = stroke_paint(parse_color(track_color, "ring.track")?, stroke);
                canvas.draw_arc(bounds, 0.0, 360.0, false, &track_paint);
            }
            let progress = progress.clamp(0.0, 1.0);
            if progress > 0.0 {
                // 0..1 swept from 12 o'clock clockwise (the wire contract).
                let arc_paint = stroke_paint(parse_color(color, "ring.color")?, stroke);
                canvas.draw_arc(bounds, -90.0, 360.0 * progress, false, &arc_paint);
            }
            Ok(())
        }
        Op::Line {
            x1,
            y1,
            x2,
            y2,
            color,
            width,
        } => {
            canvas.draw_line(
                (*x1, *y1),
                (*x2, *y2),
                &stroke_paint(parse_color(color, "line.color")?, *width),
            );
            Ok(())
        }
    }
}

fn paint_nested_op(canvas: &Canvas, op: &NestedOp, fonts: &Fonts) -> Result<(), RenderError> {
    match op {
        NestedOp::Rect {
            x,
            y,
            w,
            h,
            r,
            color,
        } => {
            canvas.draw_rrect(
                rrect(*x, *y, *w, *h, *r),
                &fill_paint(parse_color(color, "scroll-region rect.color")?),
            );
            Ok(())
        }
        NestedOp::Text {
            x,
            y,
            text,
            size,
            color,
        } => {
            let mut font = fonts.regular.clone();
            font.set_size(*size);
            canvas.draw_str(
                text,
                (*x, *y),
                &font,
                &fill_paint(parse_color(color, "scroll-region text.color")?),
            );
            Ok(())
        }
    }
}

fn rrect(x: f32, y: f32, w: f32, h: f32, r: f32) -> RRect {
    let rect = Rect::from_xywh(x, y, w, h);
    let radius = if r <= 0.0 {
        0.0
    } else {
        r.min(w / 2.0).min(h / 2.0)
    };
    let corner = Vector::new(radius, radius);
    RRect::new_rect_radii(rect, &[corner; 4])
}

fn fill_paint(color: Color4f) -> Paint {
    let mut paint = Paint::new(color, None);
    paint.set_anti_alias(true);
    paint.set_blend_mode(BlendMode::SrcOver);
    paint
}

fn stroke_paint(color: Color4f, width: f32) -> Paint {
    let mut paint = fill_paint(color);
    paint.set_style(PaintStyle::Stroke);
    paint.set_stroke_width(width.max(0.0));
    paint
}

// ---------------------------------------------------------------------------
// C ABI: the future JNI surface calls this (stage 3 wires it to Android)
// ---------------------------------------------------------------------------

/// Renders `scene_json` into `out_rgba` (len must be width*height*4).
/// Returns 0 on success; -1 bad JSON, -2 bad buffer length, -3 render.
///
/// # Safety
/// `json` must be NUL-terminated; `out_rgba` must be writable for
/// `width * height * 4` bytes.
#[no_mangle]
pub unsafe extern "C" fn tenun_skia_render_scene(
    json: *const c_char,
    width: c_int,
    height: c_int,
    out_rgba: *mut u8,
    out_len: usize,
) -> c_int {
    let scene = match std::ffi::CStr::from_ptr(json).to_str() {
        Ok(s) => s,
        Err(_) => return -1,
    };
    let w = width.max(0);
    let h = height.max(0);
    if out_len != (w as usize) * (h as usize) * 4 {
        return -2;
    }
    match render_scene(scene, w, h) {
        Ok(pixels) => {
            std::ptr::copy_nonoverlapping(pixels.as_ptr(), out_rgba, pixels.len());
            0
        }
        Err(_) => -3,
    }
}

// ---------------------------------------------------------------------------
// Tests: pixel-level proof the framework-owned renderer paints the wire
// contract (run where system fonts exist — CI ubuntu runners qualify).
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    const W: i32 = 100;
    const H: i32 = 100;

    fn scene(ops_json: &str) -> String {
        format!(
            "{{\"tenun\":\"display-list\",\"version\":1,\"designWidth\":100,\
             \"contentHeight\":100,\"background\":\"#000000\",\"ops\":[{ops_json}],\"taps\":[]}}"
        )
    }

    fn render(ops_json: &str) -> Vec<u8> {
        render_scene(&scene(ops_json), W, H).expect("render")
    }

    /// (r,g,b,a) at pixel (x,y); the buffer is RGBA8888 readback.
    fn px(pixels: &[u8], x: i32, y: i32) -> (u8, u8, u8, u8) {
        let i = ((y * W + x) * 4) as usize;
        (pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3])
    }

    #[test]
    fn background_fills_the_surface() {
        let pixels = render("");
        for y in [0, 50, 99] {
            for x in [0, 50, 99] {
                assert_eq!(px(&pixels, x, y), (0, 0, 0, 255), "at {x},{y}");
            }
        }
    }

    #[test]
    fn rect_fills_its_bounds_and_radius_clears_corners() {
        let pixels = render(
            "{\"op\":\"rect\",\"x\":10,\"y\":10,\"w\":80,\"h\":80,\"r\":0,\"color\":\"#FF0000\"}",
        );
        assert_eq!(px(&pixels, 50, 50), (255, 0, 0, 255));
        assert_eq!(px(&pixels, 12, 12), (255, 0, 0, 255));
        assert_eq!(px(&pixels, 5, 50), (0, 0, 0, 255), "outside the rect");
        let rounded = render(
            "{\"op\":\"rect\",\"x\":10,\"y\":10,\"w\":80,\"h\":80,\"r\":16,\"color\":\"#FF0000\"}",
        );
        assert_eq!(px(&rounded, 11, 11), (0, 0, 0, 255), "clipped corner");
        assert_eq!(px(&rounded, 50, 50), (255, 0, 0, 255), "center keeps fill");
    }

    #[test]
    fn outline_strokes_the_edge_not_the_fill() {
        let pixels = render(
            "{\"op\":\"outline\",\"x\":10,\"y\":10,\"w\":80,\"h\":80,\"r\":0,\
             \"color\":\"#00FF00\",\"width\":4}",
        );
        assert_eq!(px(&pixels, 50, 11), (0, 255, 0, 255), "on the stroke");
        assert_eq!(px(&pixels, 50, 50), (0, 0, 0, 255), "hollow center");
    }

    #[test]
    fn gradient_transitions_between_its_stops() {
        let pixels = render(
            "{\"op\":\"gradient\",\"x\":10,\"y\":10,\"w\":80,\"h\":80,\"r\":0,\
             \"color\":\"#000000\",\"colorTo\":\"#FFFFFF\"}",
        );
        let top = px(&pixels, 50, 12).0;
        let bottom = px(&pixels, 50, 88).0;
        assert!(top < 60, "top should be near-black, got {top}");
        assert!(bottom > 195, "bottom should be near-white, got {bottom}");
    }

    #[test]
    fn circle_and_ring_paint_their_geometry() {
        let pixels =
            render("{\"op\":\"circle\",\"cx\":30,\"cy\":30,\"r\":10,\"color\":\"#0000FF\"}");
        assert_eq!(px(&pixels, 30, 30), (0, 0, 255, 255));
        assert_eq!(px(&pixels, 30, 50), (0, 0, 0, 255));
        let ring = render(
            "{\"op\":\"ring\",\"cx\":70,\"cy\":70,\"r\":20,\"width\":6,\
             \"color\":\"#FFFF00\",\"progress\":1.0,\"track\":\"#333333\"}",
        );
        // On the ring's stroke circle, 20 units from center (12 o'clock).
        assert_eq!(px(&ring, 70, 50).0, 0xFF, "full-progress arc at 12 o'clock");
        let half = render(
            "{\"op\":\"ring\",\"cx\":70,\"cy\":70,\"r\":20,\"width\":6,\
             \"color\":\"#FFFF00\",\"progress\":0.5,\"track\":\"#333333\"}",
        );
        // The yellow arc covers 12→3 o'clock; below center stays track.
        let (r, g, _, _) = px(&half, 70, 90);
        assert!(
            r < 0x60 && g < 0x60,
            "below-center stays track gray, got {r},{g}"
        );
    }

    #[test]
    fn line_paints_between_its_endpoints() {
        let pixels = render(
            "{\"op\":\"line\",\"x1\":0,\"y1\":50,\"x2\":99,\"y2\":50,\"color\":\"#FF00FF\",\"width\":3}",
        );
        assert_eq!(px(&pixels, 50, 50), (255, 0, 255, 255));
        assert_eq!(px(&pixels, 50, 20), (0, 0, 0, 255));
    }

    #[test]
    fn text_paints_glyph_pixels() {
        let pixels = render(
            "{\"op\":\"text\",\"x\":10,\"y\":50,\"text\":\"TENUN\",\"size\":40,\
             \"weight\":400,\"color\":\"#FFFFFF\"}",
        );
        let mut white = 0;
        for y in 20..60 {
            for x in 5..95 {
                if px(&pixels, x, y).0 > 200 {
                    white += 1;
                }
            }
        }
        assert!(white > 100, "expected glyph coverage, got {white} px");
    }

    #[test]
    fn scroll_region_clips_content_to_its_viewport() {
        let pixels = render(
            "{\"op\":\"scroll-region\",\"id\":\"list\",\"x\":10,\"y\":10,\"w\":80,\"h\":40,\
             \"contentHeight\":200,\"ops\":[\
               {\"op\":\"rect\",\"x\":0,\"y\":0,\"w\":80,\"h\":200,\"r\":0,\"color\":\"#00FF00\"}]}",
        );
        assert_eq!(px(&pixels, 50, 30), (0, 255, 0, 255), "inside the region");
        assert_eq!(
            px(&pixels, 50, 70),
            (0, 0, 0, 255),
            "content below the viewport must be clipped"
        );
    }

    #[test]
    fn text_input_op_paints_nothing_but_is_accepted() {
        let pixels = render("{\"op\":\"text-input\",\"id\":\"title\"}");
        assert_eq!(px(&pixels, 50, 50), (0, 0, 0, 255));
    }

    #[test]
    fn malformed_scenes_fail_visibly() {
        assert!(render_scene(
            "{\"tenun\":\"display-list\",\"version\":2,\"ops\":[]}",
            W,
            H
        )
        .is_err());
        assert!(render_scene("{\"tenun\":\"other\",\"version\":1,\"ops\":[]}", W, H).is_err());
        assert!(render_scene(
            "{\"tenun\":\"display-list\",\"version\":1,\"ops\":[{\"op\":\"hologram\"}]}",
            W,
            H
        )
        .is_err());
        assert!(render_scene(
            "{\"tenun\":\"display-list\",\"version\":1,\"ops\":[\
              {\"op\":\"rect\",\"x\":0,\"y\":0,\"w\":1,\"h\":1,\"color\":\"red\"}]}",
            W,
            H
        )
        .is_err());
        assert!(render_scene(
            "{\"tenun\":\"display-list\",\"version\":1,\"ops\":[]}",
            0,
            10
        )
        .is_err());
    }

    #[test]
    fn design_width_scales_to_the_surface() {
        // designWidth 50 on a 100px surface = 2x scale: a 10-unit rect
        // covers 20 device pixels.
        let json = "{\"tenun\":\"display-list\",\"version\":1,\"designWidth\":50,\
                    \"contentHeight\":50,\"background\":\"#000000\",\"taps\":[],\"ops\":[\
                    {\"op\":\"rect\",\"x\":0,\"y\":0,\"w\":10,\"h\":10,\"r\":0,\"color\":\"#FF0000\"}]}";
        let pixels = render_scene(json, 100, 100).expect("render");
        assert_eq!(px(&pixels, 10, 10), (255, 0, 0, 255), "inside 20px extent");
        assert_eq!(px(&pixels, 19, 19), (255, 0, 0, 255), "edge of 20px extent");
        assert_eq!(px(&pixels, 25, 25), (0, 0, 0, 255), "beyond scaled extent");
    }

    #[test]
    fn c_abi_round_trips() {
        let json = scene(
            "{\"op\":\"rect\",\"x\":10,\"y\":10,\"w\":80,\"h\":80,\"r\":0,\"color\":\"#FF0000\"}",
        );
        let mut out = vec![0u8; (W * H * 4) as usize];
        let rc = unsafe {
            tenun_skia_render_scene(
                std::ffi::CString::new(json).unwrap().as_ptr(),
                W,
                H,
                out.as_mut_ptr(),
                out.len(),
            )
        };
        assert_eq!(rc, 0);
        assert_eq!(px(&out, 50, 50), (255, 0, 0, 255));
        // Wrong buffer length fails closed instead of writing.
        let rc = unsafe {
            tenun_skia_render_scene(
                std::ffi::CString::new("{}").unwrap().as_ptr(),
                W,
                H,
                out.as_mut_ptr(),
                out.len() - 1,
            )
        };
        assert_eq!(rc, -2);
    }
}
