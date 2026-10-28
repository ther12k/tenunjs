/** Core layout fixtures use the public Tenun JSX helpers; application TSX is covered by Day Plan. */
import { jsx, jsxs } from "@tenunjs/jsx-runtime";
import type { DisplayListScene, LayoutErrorCode, LayoutViewport } from "../src/index";
import { describe, expect, test } from "bun:test";
import {
  AppBar,
  Card,
  Center,
  Column,
  Container,
  Expanded,
  GestureDetector,
  LayoutError,
  Positioned,
  Row,
  Scaffold,
  SizedBox,
  Stack,
  Text,
  layoutScreen,
  validateLayoutViewport
} from "../src/index";
const red = "#FF0000";
const green = "#00FF00";
const blue = "#0000FF";
function box(scene: DisplayListScene, color: string) {
  const op = scene.ops.find((op) => op.op === "rect" && op.color === color);
  if (!op || op.op !== "rect")
    throw new Error(`Missing rectangle ${color}`);
  return { x: op.x, y: op.y, w: op.w, h: op.h };
}
function fails(run: () => unknown, code: LayoutErrorCode): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(LayoutError);
    if (!(error instanceof LayoutError))
      throw error;
    expect(error.code).toBe(code);
    return;
  }
  throw new Error(`Expected ${code}`);
}
describe("TN-157 bounded framework layout", () => {
  test("frozen TN-156 case 011: a 300×100 Column assigns two 50-high Expanded boxes", () => {
    const tree = jsx(SizedBox, {
      width: 300,
      height: 100,
      children: jsxs(Column, {
        align: "stretch",
        children: [
          jsx(Expanded, {
            children: jsx(Container, {
              color: red
            })
          }),
          jsx(Expanded, {
            children: jsx(Container, {
              color: green
            })
          })
        ]
      })
    });
    const { scene } = layoutScreen({}, tree, 300);
    expect(scene.contentHeight).toBe(100);
    expect(box(scene, red)).toEqual({ x: 0, y: 0, w: 300, h: 50 });
    expect(box(scene, green)).toEqual({ x: 0, y: 50, w: 300, h: 50 });
  });
  test("Column flex accounts for fixed content, padding, gaps, and weighted shares", () => {
    const tree = jsxs(Column, {
      padding: 10,
      gap: 10,
      align: "stretch",
      children: [
        jsx(Container, {
          height: 40,
          color: red
        }),
        jsx(Expanded, {
          children: jsx(Container, {
            color: green
          })
        }),
        jsx(Expanded, {
          flex: 3,
          children: jsx(Container, {
            color: blue
          })
        })
      ]
    });
    const { scene } = layoutScreen({}, tree, { width: 300, height: 260 });
    expect(box(scene, red)).toEqual({ x: 10, y: 10, w: 280, h: 40 });
    expect(box(scene, green)).toEqual({ x: 10, y: 60, w: 280, h: 45 });
    expect(box(scene, blue)).toEqual({ x: 10, y: 115, w: 280, h: 135 });
  });
  test("Scaffold and nested orthogonal flex reflow the same tree and its tap boxes", () => {
    let presses = 0;
    const tree = jsx(Scaffold, {
      appBar: jsx(AppBar, {
        title: "Bounds"
      }),
      children: jsxs(Column, {
        padding: 12,
        gap: 8,
        align: "stretch",
        children: [
          jsx(Container, {
            height: 20,
            color: blue
          }),
          jsx(Expanded, {
            children: jsxs(Row, {
              gap: 12,
              align: "stretch",
              children: [
                jsx(Expanded, {
                  children: jsx(GestureDetector, {
                    onTap: () => presses++,
                    children: jsx(Container, {
                      color: red
                    })
                  })
                }),
                jsx(Expanded, {
                  flex: 2,
                  children: jsx(Container, {
                    color: green
                  })
                })
              ]
            })
          })
        ]
      })
    });
    const small = layoutScreen({}, tree, { width: 360, height: 400 });
    const large = layoutScreen({}, tree, { width: 600, height: 500 });
    expect(box(small.scene, red)).toEqual({ x: 12, y: 136, w: 108, h: 252 });
    expect(box(small.scene, green)).toEqual({ x: 132, y: 136, w: 216, h: 252 });
    expect(box(large.scene, red)).toEqual({ x: 12, y: 136, w: 188, h: 352 });
    expect(box(large.scene, green)).toEqual({ x: 212, y: 136, w: 376, h: 352 });
    for (const rendered of [small, large]) {
      const tap = rendered.scene.taps[0];
      expect({ x: tap.x, y: tap.y, w: tap.w, h: tap.h }).toEqual(box(rendered.scene, red));
      rendered.tapRuns[tap.payload.id]();
    }
    expect(presses).toBe(2);
    expect(small.scene.contentHeight).toBe(400);
    expect(large.scene.contentHeight).toBe(500);
  });
  test("explicit Container height propagates after padding without viewport mode", () => {
    const tree = jsx(Container, {
      width: 300,
      height: 140,
      padding: 10,
      children: jsxs(Column, {
        align: "stretch",
        children: [
          jsx(Expanded, {
            children: jsx(Container, {
              color: red
            })
          }),
          jsx(Expanded, {
            children: jsx(Container, {
              color: green
            })
          })
        ]
      })
    });
    const { scene } = layoutScreen({}, tree, 400);
    expect(box(scene, red)).toEqual({ x: 10, y: 10, w: 280, h: 60 });
    expect(box(scene, green)).toEqual({ x: 10, y: 70, w: 280, h: 60 });
  });
  test("Center uses both assigned axes and loose child constraints", () => {
    const tree = jsx(SizedBox, {
      width: 300,
      height: 200,
      children: jsx(Center, {
        children: jsx(Container, {
          width: 60,
          height: 40,
          color: red
        })
      })
    });
    expect(box(layoutScreen({}, tree, 300).scene, red)).toEqual({ x: 120, y: 80, w: 60, h: 40 });
  });
  test("opposing Positioned edges constrain both dimensions, including taps", () => {
    const tree = jsx(SizedBox, {
      width: 300,
      height: 200,
      children: jsxs(Stack, {
        children: [
          jsx(SizedBox, {
            width: 300,
            height: 200
          }),
          jsx(Positioned, {
            left: 10,
            right: 20,
            top: 30,
            bottom: 40,
            children: jsx(GestureDetector, {
              onTap: () => {},
              children: jsx(Container, {
                color: red
              })
            })
          })
        ]
      })
    });
    const { scene } = layoutScreen({}, tree, 300);
    const expected = { x: 10, y: 30, w: 270, h: 130 };
    expect(box(scene, red)).toEqual(expected);
    const tap = scene.taps[0];
    expect({ x: tap.x, y: tap.y, w: tap.w, h: tap.h }).toEqual(expected);
  });
  test("bounded Column justify-center preserves intrinsic child sizes and gaps", () => {
    const tree = jsxs(Column, {
      gap: 10,
      justify: "center",
      align: "center",
      children: [
        jsx(Container, {
          width: 50,
          height: 20,
          color: red
        }),
        jsx(Container, {
          width: 30,
          height: 30,
          color: green
        })
      ]
    });
    const { scene } = layoutScreen({}, tree, { width: 300, height: 200 });
    expect(box(scene, red)).toEqual({ x: 125, y: 70, w: 50, h: 20 });
    expect(box(scene, green)).toEqual({ x: 135, y: 100, w: 30, h: 30 });
  });
  test("Row stretch forces actual cross-axis boxes, not just their positions", () => {
    const tree = jsxs(Row, {
      gap: 10,
      align: "stretch",
      children: [
        jsx(Container, {
          width: 30,
          height: 20,
          color: red
        }),
        jsx(Expanded, {
          children: jsx(GestureDetector, {
            onTap: () => {},
            children: jsx(Container, {
              color: green
            })
          })
        })
      ]
    });
    const { scene } = layoutScreen({}, tree, { width: 300, height: 120 });
    expect(box(scene, red)).toEqual({ x: 0, y: 0, w: 30, h: 120 });
    expect(box(scene, green)).toEqual({ x: 40, y: 0, w: 260, h: 120 });
    expect(scene.taps[0].h).toBe(120);
  });
  test("natural Row children retain their measurement bounds; stretch is explicit", () => {
    const content = (align: "center" | "stretch") => jsx(Column, {
      children: jsxs(Row, {
        align,
        children: [
          jsx(Container, {
            width: 100,
            height: 100,
            color: red
          }),
          jsx(Card, {
            background: green,
            padding: 16,
            children: jsx(Column, {
              children: jsx(Text, {
                children: "short"
              })
            })
          })
        ]
      })
    });
    const centered = box(layoutScreen({}, content("center"), 720).scene, green);
    expect(centered.y).toBe(22);
    expect(centered.h).toBe(56);
    const stretched = box(layoutScreen({}, content("stretch"), 720).scene, green);
    expect(stretched.y).toBe(0);
    expect(stretched.h).toBe(100);
  });
  test("Stack retains the sizing child's natural bounds after discovering its frame", () => {
    const row = jsxs(Row, {
      align: "center",
      children: [
        jsx(Container, { width: 100, height: 100, color: red }),
        jsx(Card, {
          background: green,
          padding: 16,
          children: jsx(Column, { children: jsx(Text, { children: "short" }) }),
        }),
      ],
    });
    const direct = layoutScreen({}, row, 720).scene;
    const wrapped = layoutScreen({}, jsx(Stack, { children: row }), 720).scene;
    expect(box(wrapped, green)).toEqual(box(direct, green));
    expect(box(wrapped, green).y).toBe(22);
    expect(box(wrapped, green).h).toBe(56);
    expect(wrapped.contentHeight).toBe(100);
  });
  test("exhausted flex space is zero in either axis without a manufactured one-unit box", () => {
    const row = jsxs(Row, {
      align: "stretch",
      children: [
        jsx(Container, {
          width: 100,
          color: red
        }),
        jsx(Expanded, {
          children: jsx(Container, {
            color: green
          })
        })
      ]
    });
    expect(box(layoutScreen({}, row, { width: 100, height: 40 }).scene, green)).toEqual({ x: 100, y: 0, w: 0, h: 40 });
    const column = jsxs(Column, {
      align: "stretch",
      children: [
        jsx(Container, {
          height: 100,
          color: red
        }),
        jsx(Expanded, {
          children: jsx(Container, {
            color: green
          })
        })
      ]
    });
    expect(box(layoutScreen({}, column, { width: 40, height: 100 }).scene, green)).toEqual({ x: 0, y: 100, w: 40, h: 0 });
  });
  test("bounded parents preserve overflowing intrinsic content instead of shrinking it", () => {
    const tree = jsx(Column, {
      align: "stretch",
      children: jsxs(Column, {
        children: [
          jsx(Container, {
            height: 70,
            color: red
          }),
          jsx(Container, {
            height: 70,
            color: green
          })
        ]
      })
    });
    const { scene } = layoutScreen({}, tree, { width: 300, height: 100 });
    expect(scene.contentHeight).toBe(100);
    expect(box(scene, red)).toEqual({ x: 0, y: 0, w: 300, h: 70 });
    expect(box(scene, green)).toEqual({ x: 0, y: 70, w: 300, h: 70 });
  });
  test("function components are resolved once across bounded measurement and placement", () => {
    let calls = 0;
    const Contents = () => {
      calls++;
      return jsx(Column, {
        children: jsx(Expanded, {
          children: jsx(Container, {
            color: red
          })
        })
      });
    };
    const tree = jsx(SizedBox, {
      height: 100,
      children: jsx(Contents, {})
    });
    layoutScreen({}, tree, 300);
    expect(calls).toBe(1);
    layoutScreen({}, tree, 400);
    expect(calls).toBe(2);
  });
});
describe("TN-157 constraint errors", () => {
  test("Expanded in unbounded Column fails visibly through function wrappers", () => {
    const Contents = () => jsx(Column, {
      children: jsx(Expanded, {
        children: jsx(Text, {
          children: "Unbounded"
        })
      })
    });
    fails(() => layoutScreen({}, jsx(Contents, {}), 300), "UNBOUNDED_FLEX");
    fails(() => layoutScreen({}, jsx(Column, {
      children: jsx(Contents, {})
    }), { width: 300, height: 100 }), "UNBOUNDED_FLEX");
  });
  test("viewport validation returns an immutable copy and rejects invalid roots", () => {
    const supplied = { width: 300, height: 200 };
    const saved = validateLayoutViewport(supplied);
    supplied.height = 500;
    expect(saved).toEqual({ width: 300, height: 200 });
    expect(Object.isFrozen(saved)).toBe(true);
    for (const value of [0, -1, NaN, 1 / 0]) {
      fails(() => layoutScreen({}, jsx(Text, {
        children: "Invalid"
      }), value), "INVALID_VIEWPORT");
      fails(() => validateLayoutViewport({ width: value, height: 100 }), "INVALID_VIEWPORT");
      fails(() => validateLayoutViewport({ width: 100, height: value }), "INVALID_VIEWPORT");
    }
    fails(() => validateLayoutViewport(null as unknown as LayoutViewport), "INVALID_VIEWPORT");
  });
  test("viewport validation reads and validates the exact dimensions it copies", () => {
    let widthReads = 0;
    let heightReads = 0;
    const saved = validateLayoutViewport({
      get width() {
        return ++widthReads === 1 ? 320 : NaN;
      },
      get height() {
        return ++heightReads === 1 ? 480 : NaN;
      }
    });
    expect(saved).toEqual({ width: 320, height: 480 });
    expect(widthReads).toBe(1);
    expect(heightReads).toBe(1);
  });
  test("malformed numeric widget constraints fail while genuine zero sizes remain valid", () => {
    for (const value of [-1, NaN, 1 / 0]) {
      for (const tree of [
        jsx(SizedBox, {
          width: value
        }),
        jsx(Container, {
          height: value
        }),
        jsx(Column, {
          padding: value
        }),
        jsx(Row, {
          gap: value
        }),
        jsx(Column, {
          children: jsx(Expanded, {
            flex: value,
            children: jsx(Container, {})
          })
        })
      ]) {
        fails(() => layoutScreen({}, tree, { width: 300, height: 200 }), "INVALID_CONSTRAINT");
      }
    }
    fails(() => layoutScreen({}, jsx(Row, {
      children: jsx(Expanded, {
        flex: 0
      })
    }), 300), "INVALID_CONSTRAINT");
    const zero = jsx(SizedBox, {
      width: 0,
      height: 0,
      children: jsx(Container, {
        color: red
      })
    });
    expect(box(layoutScreen({}, zero, 300).scene, red)).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });
});
