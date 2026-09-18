import { defineScreen } from "@tenunjs/core";
import {
  Button,
  Card,
  Column,
  Container,
  GestureDetector,
  Icon,
  Positioned,
  Row,
  Scaffold,
  SizedBox,
  Stack,
  Text,
  Wrap,
} from "@tenunjs/widgets";
import type { WidgetNode } from "@tenunjs/jsx-runtime";
import {
  Avatar,
  Carousel,
  CanvasBox,
  Chip,
  ListTile,
  ProgressBar,
  Tabs,
  textWidth,
} from "@tenunjs-examples/ui-kit";
import { COURSE_CATEGORIES, COURSES, type Course } from "../categories/course";

const COURSE_CARD_W = 328;
const COURSE_CARD_H = 278;

/**
 * Structural-tier media card (the HotelCard migration pattern): a sized
 * Stack base, Container hero with the decorative circle kept as a CanvasBox
 * layer, an Icon, and Positioned texts. Palette role names flow through the
 * color props.
 */
function CourseCard(props: { course: Course; onSelect: () => void }): WidgetNode {
  const { course } = props;
  return (
    <GestureDetector onTap={props.onSelect}>
      <Stack>
        <SizedBox width={COURSE_CARD_W} height={COURSE_CARD_H} />
        <Positioned top={0} left={0} right={0}>
          <Container height={148} radius={22} color={course.tint} shadow={5}>
            <CanvasBox
              width={COURSE_CARD_W}
              height={148}
              paint={(origin, put) => {
                put({ op: "circle", cx: origin.w - 48, cy: 46, r: 58, color: "#22FFFFFF" });
              }}
            />
          </Container>
        </Positioned>
        <Positioned top={44} left={28}>
          <Icon glyph={course.glyph} size={54} color="#FFFFFF" />
        </Positioned>
        <Positioned top={160} left={0}>
          <Text variant="title">{course.title}</Text>
        </Positioned>
        <Positioned top={196} left={0}>
          <Text variant="caption" color="onSurfaceVariant">{course.author} · {course.lessons} lessons</Text>
        </Positioned>
        <Positioned top={234} left={0}>
          <Text variant="label" color="success">{Math.round(course.progress * 100)}% complete</Text>
        </Positioned>
      </Stack>
    </GestureDetector>
  );
}

export interface CourseState {
  category: number;
  featured: number;
  selectedCourse: string | null;
  enrolled: string[];
  progress: Record<string, number>;
  tab: number;
}

export const CourseScreen = defineScreen({
  name: "DesignCourse",

  initialState: (): CourseState => ({
    category: 0,
    featured: 0,
    selectedCourse: null,
    enrolled: [],
    progress: Object.fromEntries(COURSES.map((course) => [course.id, course.progress])),
    tab: 0,
  }),

  actions: {
    setCategory({ state, input }: { state: CourseState; input: number }) {
      state.category = Math.max(0, Math.min(COURSE_CATEGORIES.length - 1, Math.floor(input)));
    },
    cycleFeatured({ state, input }: { state: CourseState; input: number }) {
      state.featured = (state.featured + input + COURSES.length) % COURSES.length;
    },
    selectFeatured({ state, input }: { state: CourseState; input: number }) {
      state.featured = Math.max(0, Math.min(COURSES.length - 1, Math.floor(input)));
      state.selectedCourse = COURSES[state.featured]!.id;
    },
    selectCourse({ state, input }: { state: CourseState; input: string }) {
      state.selectedCourse = input;
      const index = COURSES.findIndex((course) => course.id === input);
      if (index >= 0) state.featured = index;
    },
    setTab({ state, input }: { state: CourseState; input: number }) {
      state.tab = Math.max(0, Math.min(2, Math.floor(input)));
    },
    enroll({ state }: { state: CourseState }) {
      if (state.selectedCourse && !state.enrolled.includes(state.selectedCourse)) state.enrolled = [...state.enrolled, state.selectedCourse];
    },
    completeLesson({ state }: { state: CourseState }) {
      if (!state.selectedCourse) return;
      const current = state.progress[state.selectedCourse] ?? 0;
      state.progress = { ...state.progress, [state.selectedCourse]: Math.min(1, current + 0.12) };
    },
    backToCatalog({ state }: { state: CourseState }) {
      state.selectedCourse = null;
      state.tab = 0;
    },
  },

  view({ state, actions }) {
    const selected = state.selectedCourse ? COURSES.find((course) => course.id === state.selectedCourse) : null;
    const activeCategory = COURSE_CATEGORIES[state.category]!;
    const visible = COURSES.filter((course) => activeCategory === "All" || course.category === activeCategory);
    const rows: WidgetNode[] = [];
    for (let index = 0; index < visible.length; index += 2) {
      rows.push(<Row key={`course-row-${index}`} gap="md">{visible.slice(index, index + 2).map((course) => <CourseCard key={course.id} course={{ ...course, progress: state.progress[course.id] ?? course.progress }} onSelect={() => actions.selectCourse(course.id)} />)}</Row>);
    }

    if (selected) {
      const progress = state.progress[selected.id] ?? selected.progress;
      const enrolled = state.enrolled.includes(selected.id);
      return (
        <Scaffold>
          <Column padding="lg" gap="lg">
            <Button variant="text" onPress={() => actions.backToCatalog()}>← Back to courses</Button>
            <CanvasBox
              height={250}
              paint={(origin, put, _tap, palette) => {
                put({ op: "gradient", x: 0, y: 0, w: origin.w, h: 250, r: 28, color: selected.tint, colorTo: "#131821", shadow: 7 });
                put({ op: "circle", cx: origin.w - 72, cy: 62, r: 86, color: "#22FFFFFF" });
                put({ op: "text", x: 28, y: 112, text: selected.glyph, size: 72, weight: 700, color: "#FFFFFF" });
                put({ op: "text", x: 28, y: 174, text: selected.title, size: 28, weight: 700, color: palette.onSurface });
                put({ op: "text", x: 28, y: 210, text: `${selected.author} · ${selected.minutes} min`, size: 15, weight: 400, color: "#D8ECFF" });
              }}
            />
            <Tabs tabs={["Overview", "Lessons", "Notes"]} active={state.tab} onSelect={(index) => actions.setTab(index)} />
            {state.tab === 0 ? (
              <Card padding="lg" radius="lg" background="surfaceRaised">
                <Column gap="md">
                  <Row justify="between"><Text variant="title">Your progress</Text><Text variant="title">{Math.round(progress * 100)}%</Text></Row>
                  <ProgressBar value={progress * 100} max={100} color="#C9A8FF" />
                  <Text variant="body" color="#AEB8C8">A practical class on hierarchy, rhythm, and the tiny decisions that make a screen feel finished.</Text>
                  <Button variant="primary" onPress={() => actions.enroll()}>{enrolled ? "Enrolled" : "Enroll for free"}</Button>
                </Column>
              </Card>
            ) : null}
            {state.tab === 1 ? (
              <Column gap="sm">
                {Array.from({ length: selected.lessons }, (_, index) => {
                  const done = progress >= (index + 1) / selected.lessons;
                  return <ListTile key={`lesson-${index}`} leading={<Avatar label={done ? "✓" : String(index + 1)} size={44} color={done ? "#70D6A2" : selected.tint} textColor="#F5F7FB" />} title={`Lesson ${index + 1}: ${["The first impression", "Finding the rhythm", "A clearer hierarchy", "Make space work", "Color with purpose"][index % 5]}`} subtitle={done ? "Completed" : `${Math.round(selected.minutes / selected.lessons)} min`} trailing={index === Math.min(selected.lessons - 1, Math.floor(progress * selected.lessons)) ? <Button variant="secondary" onPress={() => actions.completeLesson()}>Complete</Button> : null} />;
                })}
              </Column>
            ) : null}
            {state.tab === 2 ? <Card padding="lg" radius="lg" background="surfaceRaised"><Text variant="body" color="#AEB8C8">Notes are kept with the course so the pattern stays close to the moment you discovered it.</Text></Card> : null}
          </Column>
        </Scaffold>
      );
    }

    return (
      <Scaffold>
        <Column padding="lg" gap="lg">
          <Row justify="between" align="center">
            <Column gap="xs"><Text variant="caption" color="#AEB8C8">THE DESIGN COURSE</Text><Text variant="title">Learn something beautiful</Text></Column>
            <Avatar label="Aa" size={48} color="#C9A8FF" textColor="#231B35" />
          </Row>
          <Text variant="body" color="#AEB8C8">Short, focused lessons for building interfaces people want to return to.</Text>
          <Carousel
            items={COURSES.map((course) => ({ glyph: course.glyph, title: course.title, subtitle: `${course.author} · ${course.lessons} lessons`, tint: course.tint }))}
            active={state.featured}
            onCycle={(direction) => actions.cycleFeatured(direction)}
            onSelect={(index) => actions.selectFeatured(index)}
          />
          <Wrap spacing="sm">{COURSE_CATEGORIES.map((category, index) => <Chip key={category} label={category} selected={state.category === index} onSelect={() => actions.setCategory(index)} />)}</Wrap>
          <Row justify="between" align="center"><Text variant="title">Continue learning</Text><Text variant="caption" color="#AEB8C8">{visible.length} courses</Text></Row>
          {rows.length > 0 ? <Column gap="md">{rows}</Column> : <Card padding="lg" radius="lg" background="surfaceRaised"><Text variant="body" color="#AEB8C8">No courses in this category.</Text></Card>}
          <Row justify="between" align="center"><Text variant="caption" color="#AEB8C8">Every card opens a real lesson state.</Text><Text variant="caption" color="#C9A8FF">{textWidth("Design systems", 13) > 0 ? "Design systems" : ""}</Text></Row>
        </Column>
      </Scaffold>
    );
  },
});
