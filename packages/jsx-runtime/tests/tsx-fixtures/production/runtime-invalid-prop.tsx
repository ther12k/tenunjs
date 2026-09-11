// Compiles cleanly (the cast defeats the type layer); the runtime prop
// codec is the layer that must reject it (TN-020 two-guarantees split).
export const node = (
  <button onPress={"not-a-function" as unknown as () => void}>bad</button>
);
