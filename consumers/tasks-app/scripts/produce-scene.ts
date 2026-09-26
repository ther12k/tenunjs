/**
 * TN-133 extraction acceptance (external-consumer path): produces a
 * host-consumable display-list scene for this application's tree using
 * ONLY the public @tenunjs/widgets API from the vendored tarballs — no
 * examples/ imports. Prints the scene digest; verify-consumer.sh asserts
 * it matches the committed fixture digest (captured from the identical
 * tree through the identical moved code inside the monorepo's package
 * tests — packages/widgets/test/display-list-scene.test.tsx uses the
 * same tree and goldens).
 */
import { createHash } from "node:crypto";
import { jsx, jsxs } from "@tenunjs/jsx-runtime/jsx-runtime";
import {
  AppBar,
  Button,
  Card,
  Column,
  layoutScreen,
  Scaffold,
  Text,
} from "@tenunjs/widgets";

const appTheme = {
  colors: { surface: "#101014", surfaceRaised: "#1C1C24", text: "#F2F2F7", accent: "#7C4DFF" },
  spacing: { sm: 8, md: 16, lg: 24 },
};

// Same tree as the monorepo "structural" golden fixture (scaffold,
// app-bar, title text, tappable button, raised card).
const tree = jsxs(Scaffold, {
  appBar: jsx(AppBar, { title: "Golden" }),
  children: jsxs(Column, {
    padding: "lg",
    gap: "md",
    children: [
      jsx(Text, { variant: "title", children: "Structural fixture" }),
      jsx(Button, { onPress: () => {}, children: "Tap me" }),
      jsx(Card, { padding: "md", radius: "md", background: "surfaceRaised", children:
        jsx(Text, { variant: "body", children: "card body" }) }),
    ],
  }),
});

const { scene } = layoutScreen(appTheme as never, tree as never, 720);

const failures: string[] = [];
if (scene.tenun !== "display-list") failures.push(`tenun marker is ${scene.tenun}`);
if (scene.version !== 1) failures.push(`version is ${scene.version}`);
if (!Array.isArray(scene.ops) || scene.ops.length === 0) failures.push("no ops emitted");
if (!Array.isArray(scene.taps) || scene.taps.length !== 1) failures.push(`taps=${scene.taps?.length}`);

if (failures.length > 0) {
  console.error("CONSUMER-SCENE-FAILED:\n" + failures.join("\n"));
  process.exit(1);
}

const json = JSON.stringify(scene, null, 2) + "\n";
console.log("CONSUMER-SCENE-OK");
console.log("scene-sha256=" + createHash("sha256").update(json).digest("hex"));
