import { defineRoutes } from "@tenunjs/navigation";
import { LauncherScreen } from "./screens/launcher.screen";
import { IntroScreen } from "./screens/intro.screen";
import { HotelScreen } from "./screens/hotel.screen";
import { FitnessShowcaseScreen } from "./screens/fitness.screen";
import { CourseScreen } from "./screens/course.screen";
import { NavigationStudyScreen } from "./screens/navigation.screen";

/**
 * The standalone example app keeps a typed-route surface rooted at the
 * launcher (`/`). The preview/launcher host treats `intro`, `hotel`,
 * `fitness`, `course`, and `navigation` as independent app sessions
 * instead of flat sibling routes.
 */
export const routes = defineRoutes({
  home: { path: "/", screen: LauncherScreen },
  intro: { path: "/intro", screen: IntroScreen },
  hotel: { path: "/hotel", screen: HotelScreen },
  fitness: { path: "/fitness", screen: FitnessShowcaseScreen },
  course: { path: "/course", screen: CourseScreen },
  navigation: { path: "/navigation", screen: NavigationStudyScreen },
});
