import { describe, expect, test } from "bun:test";
import { mountScreen } from "@tenunjs-examples/test-support";
import { LauncherScreen, HomeScreen } from "../src/screens/home.screen";
import { IntroScreen } from "../src/screens/intro.screen";
import { HotelScreen } from "../src/screens/hotel.screen";
import { FitnessShowcaseScreen } from "../src/screens/fitness.screen";
import { CourseScreen } from "../src/screens/course.screen";
import { NavigationStudyScreen } from "../src/screens/navigation.screen";
import { SHOWCASE_APPS, SHOWCASE_APP_IDS, isShowcaseAppId } from "../src/data";

describe("Showcase launcher", () => {
  test("catalogs exactly the five independent app studies", () => {
    expect(SHOWCASE_APPS.length).toBe(5);
    expect(SHOWCASE_APP_IDS).toEqual(["intro", "hotel", "fitness", "course", "navigation"]);
    expect(isShowcaseAppId("hotel")).toBe(true);
    expect(isShowcaseAppId("settings")).toBe(false);
  });

  test("HomeScreen stays the compatibility alias of the launcher", () => {
    expect(HomeScreen).toBe(LauncherScreen);
  });

  test("opens a category and closes the drawer", () => {
    const h = mountScreen(LauncherScreen);
    h.press("setDrawer", true);
    expect(h.state.drawerOpen).toBe(true);
    h.press("open", "hotel");
    expect(h.state.opened).toBe("hotel");
    expect(h.state.drawerOpen).toBe(false);
    expect(h.render()).not.toBeNull();
  });
});

describe("Introduction animation", () => {
  test("advances, skips, signs up, and restarts deterministically", () => {
    const h = mountScreen(IntroScreen);
    h.press("next");
    h.press("next");
    expect(h.state.page).toBe(2);
    h.press("next");
    expect(h.state.done).toBe(true);
    h.press("signUp");
    expect(h.state.signedUp).toBe(true);
    h.press("restart");
    expect(h.state).toMatchObject({ page: 0, done: false, signedUp: false });
  });

  test("skip lands on the account reveal", () => {
    const h = mountScreen(IntroScreen);
    h.press("skip");
    expect(h.state.done).toBe(true);
    expect(h.state.signedUp).toBe(false);
  });
});

describe("Hotel booking", () => {
  test("search, filters, selection, guests, and booking update state", () => {
    const h = mountScreen(HotelScreen);
    h.press("cycleSearch");
    expect(h.state.destination).toBe(1);
    h.press("setCategory", 2);
    expect(h.state.category).toBe(2);
    h.press("toggleFilter", 2);
    expect(h.state.filters.under150).toBe(true);
    h.press("selectHotel", "pine");
    h.press("adjustGuests", 2);
    h.press("adjustNights", -1);
    expect(h.state.selectedHotel).toBe("pine");
    expect(h.state.guests).toBe(4);
    expect(h.state.nights).toBe(2);
    h.press("bookRoom");
    expect(h.state.booked).toBe(true);
    h.press("dismissBooking");
    expect(h.state.booked).toBe(false);
  });
});

describe("Fitness template", () => {
  test("logs movement and completes the selected workout", () => {
    const h = mountScreen(FitnessShowcaseScreen);
    const beforeSteps = h.state.stepsToday;
    const beforeKcal = h.state.moveKcal;
    h.press("logWalk", 1000);
    expect(h.state.stepsToday).toBe(beforeSteps + 1000);
    expect(h.state.moveKcal).toBe(beforeKcal + 40);
    h.press("completeWorkout");
    expect(h.state.completedWorkout).toBe(true);
    expect(h.state.moveKcal).toBe(beforeKcal + 40 + 310);
    h.press("completeWorkout");
    expect(h.state.moveKcal).toBe(beforeKcal + 40 + 310);
  });
});

describe("Design course", () => {
  test("filters, opens a course, enrolls, and advances lessons", () => {
    const h = mountScreen(CourseScreen);
    h.press("setCategory", 1);
    expect(h.state.category).toBe(1);
    h.press("selectCourse", "motion");
    expect(h.state.selectedCourse).toBe("motion");
    const initial = h.state.progress.motion!;
    h.press("enroll");
    expect(h.state.enrolled).toEqual(["motion"]);
    h.press("completeLesson");
    expect(h.state.progress.motion).toBeCloseTo(initial + 0.12);
    h.press("backToCatalog");
    expect(h.state.selectedCourse).toBeNull();
  });
});

describe("Custom drawer study", () => {
  test("drawer selection and saved state persist", () => {
    const h = mountScreen(NavigationStudyScreen);
    h.press("setDrawer", true);
    expect(h.state.drawerOpen).toBe(true);
    h.press("selectDestination", 3);
    expect(h.state.active).toBe(3);
    expect(h.state.drawerOpen).toBe(false);
    h.press("toggleSaved");
    expect(h.state.saved).toBe(true);
    expect(h.render()).not.toBeNull();
  });
});
