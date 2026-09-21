import {
  defineAction,
  defineScreen,
  type ScreenActionContext,
} from "@tenunjs/core";
import {
  AppBar,
  Button,
  Card,
  Column,
  Row,
  Scaffold,
  Text,
} from "@tenunjs/widgets";

export interface TaskItem {
  id: number;
  label: string;
  done: boolean;
}

export interface TasksState {
  nextId: number;
  items: TaskItem[];
}

// Input-less by design: the framework's text-input widget is not yet part
// of the public widget layer (owned by TN-079, "usable widget layer" M4),
// so Add cycles deterministic sample labels — the same pattern as the
// monorepo's own todo-list reference example.
const SAMPLE_LABELS = [
  "Read the packaging guide",
  "Pack the tarballs",
  "Install from vendor/",
  "Compile both JSX modes",
  "Record the blockers",
];

export const TasksScreen = defineScreen({
  name: "Rehearsal Tasks",

  initialState: (): TasksState => ({
    nextId: 0,
    items: [],
  }),

  actions: {
    addTask({ state }: ScreenActionContext<TasksState>) {
      const label = SAMPLE_LABELS[state.nextId % SAMPLE_LABELS.length];
      state.items.push({ id: state.nextId, label, done: false });
      state.nextId += 1;
    },

    toggleTask: defineAction<TasksState, number>({
      run({ input, state }) {
        const item = state.items.find((candidate) => candidate.id === input);
        if (item) item.done = !item.done;
      },
    }),

    clearDone({ state }: ScreenActionContext<TasksState>) {
      state.items = state.items.filter((item) => !item.done);
    },

    toggleAll({ state }: ScreenActionContext<TasksState>) {
      const anyOpen = state.items.some((item) => !item.done);
      for (const item of state.items) item.done = anyOpen;
    },
  },

  view({ state, actions }) {
    const doneCount = state.items.filter((item) => item.done).length;

    return (
      <Scaffold appBar={<AppBar title="Rehearsal Tasks" />}>
        <Column padding="lg" gap="lg" align="start">
          <Text variant="title">
            {doneCount} of {state.items.length} done
          </Text>

          <Row gap="md">
            <Button onPress={actions.addTask}>Add</Button>
            <Button variant="secondary" onPress={actions.toggleAll}>
              Toggle all
            </Button>
            <Button variant="secondary" onPress={actions.clearDone}>
              Clear completed
            </Button>
          </Row>

          {state.items.length === 0 ? (
            <Card padding="lg" radius="md" background="surfaceRaised">
              <Text variant="body">No tasks yet. Press Add to begin.</Text>
            </Card>
          ) : (
            <Column gap="sm">
              {state.items.map((item) => (
                <Card
                  key={item.id}
                  padding="md"
                  radius="md"
                  background="surfaceRaised"
                >
                  <Row gap="md" align="center">
                    <Text variant="body">
                      {item.done ? `✓ ${item.label}` : item.label}
                    </Text>
                    <Button
                      variant={item.done ? "tonal" : "primary"}
                      onPress={() => actions.toggleTask(item.id)}
                    >
                      {item.done ? "Undo" : "Done"}
                    </Button>
                  </Row>
                </Card>
              ))}
            </Column>
          )}
        </Column>
      </Scaffold>
    );
  },
});
