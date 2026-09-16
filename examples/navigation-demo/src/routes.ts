import { defineRoutes } from "@tenunjs/navigation";
import { HomeScreen } from "./screens/home.screen";
import { ProfileScreen } from "./screens/profile/profile.view";

// Typed route table: path patterns plus their screens. Route params are
// validated through the same schemas as incoming deep links once the
// executable application model lands (M3).
export const routes = defineRoutes({
  home: { path: "/", screen: HomeScreen },
  profile: { path: "/profile/:memberId", screen: ProfileScreen },
});
