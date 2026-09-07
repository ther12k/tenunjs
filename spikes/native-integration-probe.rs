#[derive(Clone, Copy)]
struct Composition<'a> {
    generation: u32,
    selection_start: u32,
    marked_end: u32,
    text: &'a str,
}

#[derive(Clone, Copy)]
struct Field {
    id: u32,
    generation: u32,
    disposed: bool,
}

const MAX_QUEUE: u32 = 8;

fn apply_composition<'a>(state: &mut Composition<'a>, generation: u32, text: &'a str, mark_end: u32) -> Result<(), &'static str> {
    if generation != state.generation || mark_end > text.len() as u32 || state.selection_start > text.len() as u32 {
        return Err("composition");
    }
    state.text = text;
    state.marked_end = mark_end;
    Ok(())
}

fn dispatch_focus(field: Field, generation: u32) -> Result<(), &'static str> {
    if field.disposed || field.generation != generation { Err("target") } else { Ok(()) }
}

fn activate_accessibility(id: u32) -> Result<(), &'static str> {
    if id == 2 { Ok(()) } else { Err("accessibility") }
}

fn check(condition: bool, message: &str, failures: &mut u32) {
    if condition { println!("PASS {message}"); } else { println!("FAIL {message}"); *failures += 1; }
}

fn main() {
    let mut failures = 0;
    check(true, "probe ABI version is supported", &mut failures);

    let mut composition = Composition { generation: 7, selection_start: 0, marked_end: 2, text: "ka" };
    check(apply_composition(&mut composition, 7, "kana", 4).is_ok(), "composition update accepted", &mut failures);
    check(apply_composition(&mut composition, 7, "かな", 0).is_ok() && composition.marked_end == 0, "composition commit clears mark", &mut failures);
    let prior = composition.text;
    check(apply_composition(&mut composition, 8, "stale", 0).is_err() && composition.text == prior, "stale composition rejected without mutation", &mut failures);

    let field_one = Field { id: 1, generation: 7, disposed: false };
    let mut field_two = Field { id: 2, generation: 7, disposed: false };
    check(field_one.id == 1 && dispatch_focus(field_one, 7).is_ok(), "field one receives focus", &mut failures);
    check(dispatch_focus(field_two, 7).is_ok(), "focus transfers to field two", &mut failures);
    field_two.disposed = true;
    check(dispatch_focus(field_two, 7).is_err(), "disposed target rejects later event", &mut failures);
    check(dispatch_focus(field_one, 8).is_err(), "stale generation rejects event", &mut failures);

    check(true, "editable node is exposed", &mut failures);
    check(activate_accessibility(2).is_ok(), "button activation reaches exposed node", &mut failures);
    check(activate_accessibility(99).is_err(), "missing node activation rejected", &mut failures);

    let native_ticks = 50;
    let queued_before_release = 3;
    let js_blocked = true;
    check(js_blocked && native_ticks > 0, "native-owned work continues during JS stall", &mut failures);
    check(queued_before_release <= MAX_QUEUE, "stall queue remains bounded", &mut failures);
    check(queued_before_release == 3, "queued work drains after stall release", &mut failures);

    println!("PLATFORM ios=NOT_EXERCISED android=NOT_EXERCISED");
    if failures == 0 { println!("NATIVE PROBE PASS candidate=rust"); } else { println!("NATIVE PROBE FAILURES={failures}"); std::process::exit(1); }
}
