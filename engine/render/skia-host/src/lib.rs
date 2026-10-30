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
//! Scene parity (TN-184): the wire's full vocabulary paints — #rrggbb
//! AND #aarrggbb literals, the complete op set inside scroll regions,
//! text clips and align/width centering boxes, fixed/anchor overlays as
//! the hosts' second pass, emboldened weight >= 600, and centerline
//! rings with round caps.
//!
//! Known gap: `shadow` (elevation) values are not painted yet —
//! elevation rendering moves to Skia image filters with the GPU stage
//! (documented in ADR-0026).

use std::os::raw::{c_char, c_int};

use skia_safe::{
    gradient_shader, AlphaType, BlendMode, Canvas, Color4f, ColorType, Font, FontMgr, ISize,
    ImageInfo, Paint, PaintCap, PaintStyle, Point, RRect, Rect, TileMode, Vector,
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

/// Fixed-overlay placement (the wire's FixedPosition): `fixed` ops paint
/// in a viewport layer above the scrollable body; `anchor`/`anchorSize`
/// offset them from the top (the anchorOffset rule both platform hosts
/// and the browser twin honor).
#[derive(Debug, serde::Deserialize, Default, Clone, Copy)]
struct Placement {
    #[serde(default)]
    fixed: bool,
    #[serde(default)]
    anchor: Option<FixedAnchor>,
    #[serde(default, rename = "anchorSize")]
    anchor_size: Option<f32>,
}

const BODY_PLACEMENT: Placement = Placement {
    fixed: false,
    anchor: None,
    anchor_size: None,
};

#[derive(Debug, serde::Deserialize, Clone, Copy)]
#[serde(rename_all = "kebab-case")]
enum FixedAnchor {
    Bottom,
    Center,
}

/// The wire's text alignment vocabulary: "center" centers inside the
/// op's width box; "left" (explicit or absent) is the start.
#[derive(Debug, serde::Deserialize, Clone, Copy)]
#[serde(rename_all = "kebab-case")]
enum TextAlign {
    Left,
    Center,
}

/// A text op's hard clip rectangle, in the same coordinate space as the op.
#[derive(Debug, serde::Deserialize, Clone, Copy)]
struct ClipRect {
    x: f32,
    y: f32,
    w: f32,
    h: f32,
}

fn anchor_offset(placement: &Placement, visible_height: f32) -> f32 {
    if !placement.fixed {
        return 0.0;
    }
    match (placement.anchor, placement.anchor_size) {
        (Some(FixedAnchor::Bottom), Some(size)) => visible_height - size,
        (Some(FixedAnchor::Center), Some(size)) => (visible_height - size) / 2.0,
        _ => 0.0,
    }
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
        /// Accepted (the wire carries it) but unpainted at stage 2 —
        /// elevation shadows arrive with ADR-0026 stage 3 (image filters).
        #[serde(default)]
        #[allow(dead_code)]
        shadow: Option<f32>,
        #[serde(flatten)]
        placement: Placement,
    },
    Outline {
        x: f32,
        y: f32,
        w: f32,
        h: f32,
        r: f32,
        color: String,
        width: f32,
        #[serde(flatten)]
        placement: Placement,
    },
    Text {
        x: f32,
        y: f32,
        text: String,
        size: f32,
        #[serde(default = "default_weight")]
        weight: i32,
        color: String,
        #[serde(default)]
        align: Option<TextAlign>,
        #[serde(default)]
        width: Option<f32>,
        #[serde(default)]
        clip: Option<ClipRect>,
        #[serde(flatten)]
        placement: Placement,
    },
    Circle {
        #[serde(rename = "cx")]
        cx: f32,
        #[serde(rename = "cy")]
        cy: f32,
        r: f32,
        color: String,
        #[serde(flatten)]
        placement: Placement,
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
        #[serde(flatten)]
        placement: Placement,
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
        #[serde(flatten)]
        placement: Placement,
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
        #[serde(default)]
        #[allow(dead_code)]
        shadow: Option<f32>,
        #[serde(flatten)]
        placement: Placement,
    },
    /// Accepted (the wire carries it) but painted by the host's input
    /// layer, not the painter — the visible field content arrives as
    /// separate text/rect ops, exactly like the other hosts. The
    /// descriptor's editing contract (ids, focus uniqueness) is validated
    /// by the input layer that owns it, not by the painter.
    TextInput {
        #[allow(dead_code)]
        id: String,
        #[serde(flatten)]
        placement: Placement,
    },
    ScrollRegion {
        #[allow(dead_code)]
        id: String,
        x: f32,
        y: f32,
        w: f32,
        h: f32,
        #[serde(default)]
        #[serde(rename = "contentHeight")]
        #[allow(dead_code)]
        content_height: f32,
        /// The SAME op set as the root: a scroll region's content is
        /// ordinary display ops in content space (the contract the
        /// lowering emits — buttons are rect+text, fields carry outlines,
        /// pages paint circles and gradients). Stage 2 accepted only
        /// rect/text here, so valid scrollable scenes failed whole.
        ops: Vec<Op>,
    },
}

impl Op {
    fn placement(&self) -> &Placement {
        match self {
            Op::Rect { placement, .. }
            | Op::Outline { placement, .. }
            | Op::Text { placement, .. }
            | Op::Circle { placement, .. }
            | Op::Ring { placement, .. }
            | Op::Line { placement, .. }
            | Op::Gradient { placement, .. }
            | Op::TextInput { placement, .. } => placement,
            Op::ScrollRegion { .. } => &BODY_PLACEMENT,
        }
    }
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
// Color parsing: the wire's literals — #rrggbb, and the Android-style
// #aarrggbb the other hosts parse natively (alpha LEADS; e.g. the
// milestone app's translucent control fills). Anything else fails the
// scene whole (fail-visible, never a partial frame).
// ---------------------------------------------------------------------------

fn parse_color(value: &str, where_: &str) -> Result<Color4f, RenderError> {
    let invalid = || {
        RenderError(format!(
            "{where_}: color \"{value}\" is not a #rrggbb/#aarrggbb literal"
        ))
    };
    let hex = value.strip_prefix('#').ok_or_else(invalid)?;
    let channel = |range: std::ops::Range<usize>| {
        u8::from_str_radix(&hex[range], 16).expect("validated hex digit") as f32 / 255.0
    };
    if hex.len() == 6 && hex.chars().all(|c| c.is_ascii_hexdigit()) {
        Ok(Color4f::new(
            channel(0..2),
            channel(2..4),
            channel(4..6),
            1.0,
        ))
    } else if hex.len() == 8 && hex.chars().all(|c| c.is_ascii_hexdigit()) {
        Ok(Color4f::new(
            channel(2..4),
            channel(4..6),
            channel(6..8),
            channel(0..2),
        ))
    } else {
        Err(invalid())
    }
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
    let visible_height = if scale > 0.0 {
        height as f32 / scale
    } else {
        height as f32
    };
    let fonts = default_fonts()?;

    // The hosts' two-pass rule: the scrollable body paints first, then a
    // fixed-overlay layer ABOVE it, anchored in viewport coordinates
    // (fixed ops never scroll with the body). Stage 2 painted everything
    // in one pass, so fixed/anchor fields silently did nothing.
    canvas.save();
    canvas.scale((scale, scale));
    for op in &scene.ops {
        if op.placement().fixed {
            continue;
        }
        paint_op(canvas, op, &fonts, 0.0)?;
    }
    canvas.restore();

    canvas.save();
    canvas.scale((scale, scale));
    for op in &scene.ops {
        let placement = op.placement();
        if !placement.fixed {
            continue;
        }
        let dy = anchor_offset(placement, visible_height);
        paint_op(canvas, op, &fonts, dy)?;
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

impl Fonts {
    /// A working copy sized per op. weight >= 600 takes the BOLD slot —
    /// a real bold typeface, not the normal one (stage 2 shipped two
    /// normal fonts, so bold and regular rendered identically).
    fn for_weight(&self, weight: i32) -> Font {
        if weight >= 600 {
            self.bold.clone()
        } else {
            self.regular.clone()
        }
    }
}

fn default_fonts() -> Result<Fonts, RenderError> {
    let mgr = FontMgr::default();
    let regular = mgr
        .legacy_make_typeface(None, skia_safe::FontStyle::normal())
        .ok_or_else(|| RenderError("no system typeface available for text rendering".into()))?;
    let bold = mgr
        .legacy_make_typeface(None, skia_safe::FontStyle::bold())
        .ok_or_else(|| {
            RenderError("no bold system typeface available for text rendering".into())
        })?;
    Ok(Fonts {
        regular: Font::from_typeface(regular, 18.0),
        bold: Font::from_typeface(bold, 18.0),
    })
}

/// Paints one op at a vertical offset [dy] (0 in the scrollable body and
/// in scroll-region content — fixed placement is a ROOT-level concept;
/// the anchor offset in the fixed-overlay pass). One painter serves both
/// levels: the region's children are the SAME op set as the root.
fn paint_op(canvas: &Canvas, op: &Op, fonts: &Fonts, dy: f32) -> Result<(), RenderError> {
    match op {
        Op::TextInput { .. } => Ok(()),
        Op::ScrollRegion {
            x, y, w, h, ops, ..
        } => {
            // The TN-161 rule: the viewport box clips, content paints in
            // its own coordinate space (the host applies its scroll offset
            // before calling; this renderer is given settled offsets).
            // Nested regions are a contract violation the other hosts
            // reject whole — this one fails visibly too.
            canvas.save();
            canvas.clip_rect(
                Rect::from_xywh(*x, *y + dy, *w, *h),
                skia_safe::ClipOp::Intersect,
                true,
            );
            canvas.translate((*x, *y + dy));
            let mut result = Ok(());
            for nested in ops {
                if matches!(nested, Op::ScrollRegion { .. }) {
                    result = Err(RenderError(
                        "nested scroll regions are not supported".into(),
                    ));
                    break;
                }
                if let Err(e) = paint_op(canvas, nested, fonts, 0.0) {
                    result = Err(e);
                    break;
                }
            }
            canvas.restore();
            result
        }
        Op::Rect {
            x,
            y,
            w,
            h,
            r,
            color,
            color_to,
            ..
        } => {
            let mut paint = fill_paint(parse_color(color, "rect.color")?);
            if let Some(to) = color_to {
                let colors = [
                    parse_color(color, "rect.color")?,
                    parse_color(to, "rect.colorTo")?,
                ];
                let shader = gradient_shader::linear(
                    (Point::new(*x, *y + dy), Point::new(*x, *y + dy + *h)),
                    colors.as_slice(),
                    None,
                    TileMode::Clamp,
                    None,
                    None,
                )
                .ok_or_else(|| RenderError("gradient shader creation failed".into()))?;
                paint.set_shader(shader);
            }
            canvas.draw_rrect(rrect(*x, *y + dy, *w, *h, *r), &paint);
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
            ..
        } => {
            let colors = [
                parse_color(color, "gradient.color")?,
                parse_color(color_to, "gradient.colorTo")?,
            ];
            let shader = gradient_shader::linear(
                (Point::new(*x, *y + dy), Point::new(*x, *y + dy + *h)),
                colors.as_slice(),
                None,
                TileMode::Clamp,
                None,
                None,
            )
            .ok_or_else(|| RenderError("gradient shader creation failed".into()))?;
            let mut paint = fill_paint(Color4f::new(0.0, 0.0, 0.0, 1.0));
            paint.set_shader(shader);
            canvas.draw_rrect(rrect(*x, *y + dy, *w, *h, *r), &paint);
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
            ..
        } => {
            let paint = stroke_paint(parse_color(color, "outline.color")?, *width);
            canvas.draw_rrect(rrect(*x, *y + dy, *w, *h, *r), &paint);
            Ok(())
        }
        Op::Text {
            x,
            y,
            text,
            size,
            weight,
            color,
            align,
            width,
            clip,
            ..
        } => {
            let t = TextPaint {
                x: *x,
                y: *y + dy,
                text,
                size: *size,
                weight: *weight,
                color,
                align: *align,
                width: *width,
                // The clip rides the same vertical offset the glyphs do
                // (the browser twin translates clip.y with op.y).
                clip: clip.map(|c| ClipRect {
                    x: c.x,
                    y: c.y + dy,
                    w: c.w,
                    h: c.h,
                }),
            };
            paint_text(canvas, &t, fonts)
        }
        Op::Circle {
            cx, cy, r, color, ..
        } => {
            canvas.draw_circle(
                (*cx, *cy + dy),
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
            ..
        } => {
            // The hosts' centerline rule: r IS the stroke's center radius
            // — the arc bounds circle, NOT inset by half the stroke
            // (stage 2 inset every ring, painting it smaller than the
            // browser and Android hosts). Round caps match their
            // lineCap; sweep runs 12 o'clock clockwise.
            let stroke = *width;
            let bounds = Rect::from_ltrb(cx - r, cy - r + dy, cx + r, cy + r + dy);
            if let Some(track_color) = track {
                let mut track_paint = stroke_paint(parse_color(track_color, "ring.track")?, stroke);
                track_paint.set_stroke_cap(PaintCap::Round);
                canvas.draw_arc(bounds, 0.0, 360.0, false, &track_paint);
            }
            let progress = progress.clamp(0.0, 1.0);
            if progress > 0.0 {
                let mut arc_paint = stroke_paint(parse_color(color, "ring.color")?, stroke);
                arc_paint.set_stroke_cap(PaintCap::Round);
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
            ..
        } => {
            canvas.draw_line(
                (*x1, *y1 + dy),
                (*x2, *y2 + dy),
                &stroke_paint(parse_color(color, "line.color")?, *width),
            );
            Ok(())
        }
    }
}

/// One text op's paint parameters, offset-resolved and grouped for the
/// painter (dy already folded into y/clip).
struct TextPaint<'a> {
    x: f32,
    y: f32,
    text: &'a str,
    size: f32,
    weight: i32,
    color: &'a str,
    align: Option<TextAlign>,
    width: Option<f32>,
    clip: Option<ClipRect>,
}

/// Text with the scene's own contract honored: baseline `y`, hard clip in
/// the same coordinate space, and align/width as a centering box measured
/// with the SAME font that paints the glyphs (the browser twin's rule).
fn paint_text(canvas: &Canvas, t: &TextPaint, fonts: &Fonts) -> Result<(), RenderError> {
    let mut font = fonts.for_weight(t.weight);
    font.set_size(t.size);
    let paint = fill_paint(parse_color(t.color, "text.color")?);
    if let Some(clip) = &t.clip {
        if clip.w < 0.0 || clip.h < 0.0 {
            return Err(RenderError("text.clip must have nonnegative size".into()));
        }
        canvas.save();
        canvas.clip_rect(
            Rect::from_xywh(clip.x, clip.y, clip.w, clip.h),
            skia_safe::ClipOp::Intersect,
            true,
        );
    }
    let mut draw_x = t.x;
    if let (Some(TextAlign::Center), Some(box_width)) = (t.align, t.width) {
        let measured = font.measure_str(t.text, None).0;
        draw_x = t.x + ((box_width - measured) / 2.0).max(0.0);
    }
    canvas.draw_str(t.text, (draw_x, t.y), &font, &paint);
    if t.clip.is_some() {
        canvas.restore();
    }
    Ok(())
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
        // The yellow arc covers 12→3 o'clock (round caps bulge a few
        // units PAST the 3-o'clock endpoint, matching Android's lineCap),
        // so probe down-LEFT at 135° — squarely on the stroke band but
        // past cap reach: that stays track gray.
        let (r, g, _, _) = px(&half, 57, 83);
        assert!(
            r < 0x60 && g < 0x60,
            "past the arc's end stays track gray, got {r},{g}"
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
        // Wrong-length hex literals fail whole — 5 and 7 digits are
        // neither #rrggbb nor #aarrggbb.
        for bad in ["\"#12345\"", "\"#1234567\""] {
            assert!(render_scene(
                &format!(
                    "{{\"tenun\":\"display-list\",\"version\":1,\"ops\":[\
                      {{\"op\":\"rect\",\"x\":0,\"y\":0,\"w\":1,\"h\":1,\"color\":{bad}}}]}}"
                ),
                W,
                H
            )
            .is_err());
        }
        assert!(render_scene(
            "{\"tenun\":\"display-list\",\"version\":1,\"ops\":[]}",
            0,
            10
        )
        .is_err());
    }

    /// Count of non-background (non-black) pixels in the window — the
    /// coverage probe for clip/align/bold assertions.
    fn ink(pixels: &[u8], x0: i32, y0: i32, x1: i32, y1: i32) -> usize {
        let mut n = 0;
        for y in y0..y1 {
            for x in x0..x1 {
                if px(pixels, x, y).0 > 60 || px(pixels, x, y).1 > 60 {
                    n += 1;
                }
            }
        }
        n
    }

    #[test]
    fn alpha_colors_blend_over_the_background() {
        // 50% white over red: 0.5*255 + 0.5*255 = 255 red-channel,
        // 0.5*255 + 0 = ~128 green/blue (SrcOver, premultiplied).
        let pixels = render_scene(
            &scene(
                "{\"op\":\"rect\",\"x\":10,\"y\":10,\"w\":80,\"h\":80,\"r\":0,\"color\":\"#80FFFFFF\"}",
            )
            .replace("\"background\":\"#000000\"", "\"background\":\"#FF0000\""),
            W,
            H,
        )
        .expect("alpha literal renders");
        let (r, g, b, a) = px(&pixels, 50, 50);
        assert!((r as i32 - 255).abs() <= 2, "red blends, got {r}");
        assert!((g as i32 - 128).abs() <= 6, "green half-alpha, got {g}");
        assert!((b as i32 - 128).abs() <= 6, "blue half-alpha, got {b}");
        assert_eq!(a, 255, "surface stays opaque");
    }

    #[test]
    fn text_clip_hides_the_unclipped_extent() {
        let unclipped = render(
            "{\"op\":\"text\",\"x\":0,\"y\":50,\"text\":\"TENUN\",\"size\":30,\
             \"weight\":400,\"color\":\"#FFFFFF\"}",
        );
        let clipped = render(
            "{\"op\":\"text\",\"x\":0,\"y\":50,\"text\":\"TENUN\",\"size\":30,\
             \"weight\":400,\"color\":\"#FFFFFF\",\"clip\":{\"x\":0,\"y\":0,\"w\":0,\"h\":100}}",
        );
        let before = ink(&unclipped, 0, 0, 100, 100);
        let after = ink(&clipped, 0, 0, 100, 100);
        assert!(before > 100, "unclipped glyphs paint, got {before}");
        assert_eq!(after, 0, "zero-width clip paints nothing");
    }

    #[test]
    fn centered_text_shifts_inside_its_width_box() {
        let left = render(
            "{\"op\":\"text\",\"x\":0,\"y\":50,\"text\":\"HI\",\"size\":30,\
             \"weight\":400,\"color\":\"#FFFFFF\",\"width\":100}",
        );
        let centered = render(
            "{\"op\":\"text\",\"x\":0,\"y\":50,\"text\":\"HI\",\"size\":30,\
             \"weight\":400,\"color\":\"#FFFFFF\",\"width\":100,\"align\":\"center\"}",
        );
        // Short glyphs in a wide box: left-aligned ink starts at the box
        // edge; centered ink starts ~((100-measured)/2) in. The left edge
        // empties and the middle fills.
        assert!(ink(&left, 0, 0, 15, 100) > 0, "left-aligned starts at x=0");
        assert!(
            ink(&centered, 0, 0, 15, 100) == 0,
            "centered text leaves the left edge"
        );
        assert!(
            ink(&centered, 25, 0, 70, 100) > 0,
            "centered ink sits inside the box's middle"
        );
    }

    #[test]
    fn bold_weight_paints_heavier_ink() {
        let regular = render(
            "{\"op\":\"text\",\"x\":0,\"y\":50,\"text\":\"TENUN\",\"size\":30,\
             \"weight\":400,\"color\":\"#FFFFFF\"}",
        );
        let bold = render(
            "{\"op\":\"text\",\"x\":0,\"y\":50,\"text\":\"TENUN\",\"size\":30,\
             \"weight\":700,\"color\":\"#FFFFFF\"}",
        );
        assert!(
            ink(&bold, 0, 0, 100, 100) > ink(&regular, 0, 0, 100, 100),
            "emboldened glyphs cover more pixels ({} > {})",
            ink(&bold, 0, 0, 100, 100),
            ink(&regular, 0, 0, 100, 100)
        );
    }

    #[test]
    fn fixed_bottom_anchor_paints_in_the_overlay_layer() {
        let pixels = render(
            "{\"op\":\"rect\",\"x\":0,\"y\":0,\"w\":100,\"h\":20,\"r\":0,\
             \"color\":\"#FFFFFF\",\"fixed\":true,\"anchor\":\"bottom\",\"anchorSize\":20}",
        );
        assert_eq!(px(&pixels, 50, 85), (255, 255, 255, 255), "anchored band");
        assert_eq!(px(&pixels, 50, 10), (0, 0, 0, 255), "top stays background");
    }

    #[test]
    fn ring_paints_the_centerline_radius_with_round_cap() {
        // r=20 width=6: the stroke spans radius 17..23 from center (the
        // centerline rule) — stage 2's inset stopped it at 20.
        let ring = render(
            "{\"op\":\"ring\",\"cx\":50,\"cy\":50,\"r\":20,\"width\":6,\
             \"color\":\"#FFFFFF\",\"progress\":1.0}",
        );
        assert!(px(&ring, 50, 28).0 > 60, "ink at radius 22 (inside 23)");
        assert!(
            px(&ring, 50, 26).0 <= 60,
            "no ink at radius 24 (outside 23)"
        );
    }

    #[test]
    fn scroll_regions_accept_the_full_op_set_and_reject_nesting() {
        // Ordinary content ops in a region — the shapes stage 2 rejected.
        let pixels = render(
            "{\"op\":\"scroll-region\",\"id\":\"list\",\"x\":0,\"y\":0,\"w\":100,\"h\":100,\
             \"contentHeight\":200,\"ops\":[\
               {\"op\":\"circle\",\"cx\":30,\"cy\":30,\"r\":10,\"color\":\"#0000FF\"},\
               {\"op\":\"outline\",\"x\":60,\"y\":60,\"w\":30,\"h\":30,\"r\":0,\"color\":\"#00FF00\",\"width\":4},\
               {\"op\":\"line\",\"x1\":0,\"y1\":90,\"x2\":99,\"y2\":90,\"color\":\"#FF00FF\",\"width\":3},\
               {\"op\":\"text-input\",\"id\":\"title\"}]}",
        );
        assert_eq!(
            px(&pixels, 30, 30),
            (0, 0, 255, 255),
            "circle in content space"
        );
        assert_eq!(
            px(&pixels, 75, 61),
            (0, 255, 0, 255),
            "outline in content space"
        );
        assert_eq!(
            px(&pixels, 50, 90),
            (255, 0, 255, 255),
            "line in content space"
        );
        // Nested regions are a contract violation — fail visible, whole.
        assert!(render_scene(
            &scene(
                "{\"op\":\"scroll-region\",\"id\":\"outer\",\"x\":0,\"y\":0,\"w\":100,\"h\":100,\
                 \"ops\":[{\"op\":\"scroll-region\",\"id\":\"inner\",\"x\":0,\"y\":0,\"w\":50,\"h\":50,\"ops\":[]}]}",
            ),
            W,
            H
        )
        .is_err());
    }

    #[test]
    fn clipped_region_text_honors_its_own_clip() {
        // A nested text whose clip ends mid-glyph: nothing paints below
        // the clip line even though the region is taller.
        let pixels = render(
            "{\"op\":\"scroll-region\",\"id\":\"list\",\"x\":0,\"y\":0,\"w\":100,\"h\":100,\
             \"contentHeight\":200,\"ops\":[\
               {\"op\":\"text\",\"x\":10,\"y\":50,\"text\":\"TENUN\",\"size\":30,\"color\":\"#FFFFFF\",\
                \"clip\":{\"x\":0,\"y\":0,\"w\":100,\"h\":30}}]}",
        );
        assert_eq!(ink(&pixels, 0, 30, 100, 100), 0, "clip bounds the glyphs");
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
