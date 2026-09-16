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

export interface Task {
  id: number;
  title: string;
  done: boolean;
}

export interface TasksState {
  nextId: number;
  tasks: Task[];
}

// Add is input-less: sample titles rotate deterministically so the demo
// has content without a text-input widget (the input widget lands with
// the usable widget layer in M4).
const SAMPLE_TITLES = [
  "Warp the loom",
  "Dye the yarn",
  "Thread the heddles",
  "Sketch the pattern",
  "Beat the weft",
];

export const TasksScreen = defineScreen({
  name: "Tasks",

  initialState: (): TasksState => ({
    nextId: 0,
    tasks: [],
  }),

  actions: {
    addTask({ state }: ScreenActionContext<TasksState>) {
      const title = SAMPLE_TITLES[state.nextId % SAMPLE_TITLES.length];
      state.tasks.push({ id: state.nextId, title, done: false });
      state.nextId += 1;
    },

    toggleTask: defineAction<TasksState, number>({
      run({ input, state }) {
        const task = state.tasks.find((candidate) => candidate.id === input);
        if (task) task.done = !task.done;
      },
    }),

    removeTask: defineAction<TasksState, number>({
      run({ input, state }) {
        state.tasks = state.tasks.filter((candidate) => candidate.id !== input);
      },
    }),

    clearCompleted({ state }: ScreenActionContext<TasksState>) {
      state.tasks = state.tasks.filter((candidate) => !candidate.done);
    },
  },

  view({ state, actions }) {
    const doneCount = state.tasks.filter((task) => task.done).length;

    return (
      <Scaffold appBar={<AppBar title="Tenun Tasks" />}>
        <Column padding="lg" gap="md">
          <Text variant="title">
            {doneCount} of {state.tasks.length} done
          </Text>

          <Row gap="md">
            <Button onPress={actions.addTask}>Add a task</Button>
            <Button variant="secondary" onPress={actions.clearCompleted}>
              Clear done
            </Button>
          </Row>

          {state.tasks.length === 0 ? (
            <Card padding="lg" radius="md" background="surfaceRaised">
              <Text variant="body">
                Everything is woven. Add a task to get started.
              </Text>
            </Card>
          ) : (
            <Column gap="sm">
              {state.tasks.map((task) => (
                <Card
                  padding="md"
                  radius="md"
                  background="surfaceRaised"
                >
                  <Column gap="sm">
                    <Text variant="body">
                      {task.done ? `✓ ${task.title}` : task.title}
                    </Text>
                    <Row gap="sm">
                      <Button
                        variant="secondary"
                        onPress={() => actions.toggleTask(task.id)}
                      >
                        {task.done ? "Undo" : "Done"}
                      </Button>
                      <Button
                        variant="danger"
                        onPress={() => actions.removeTask(task.id)}
                      >
                        Remove
                      </Button>
                    </Row>
                  </Column>
                </Card>
              ))}
            </Column>
          )}
        </Column>
      </Scaffold>
    );
  },
});
