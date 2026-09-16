import { defineRoutes } from "@tenunjs/navigation";
import { HomeScreen } from "./screens/home.screen";
import { BankingScreen } from "./screens/banking.screen";
import { SmartHomeScreen } from "./screens/smart-home.screen";
import { FitnessScreen } from "./screens/fitness.screen";
import { StoreScreen } from "./screens/store.screen";
import { SettingsScreen } from "./screens/settings.screen";
import { WeatherScreen } from "./screens/weather.screen";
import { MusicScreen } from "./screens/music.screen";
import { ChatScreen } from "./screens/chat.screen";
import { RecipesScreen } from "./screens/recipes.screen";
import { CryptoScreen } from "./screens/crypto.screen";

// Typed route table: one route per Flutter-inspired module. Route params
// are validated through the same schemas as incoming deep links once the
// executable application model lands (M3).
export const routes = defineRoutes({
  home: { path: "/", screen: HomeScreen },
  banking: { path: "/banking", screen: BankingScreen },
  smartHome: { path: "/smart-home", screen: SmartHomeScreen },
  fitness: { path: "/fitness", screen: FitnessScreen },
  store: { path: "/store", screen: StoreScreen },
  settings: { path: "/settings", screen: SettingsScreen },
  weather: { path: "/weather", screen: WeatherScreen },
  music: { path: "/music", screen: MusicScreen },
  chat: { path: "/chat", screen: ChatScreen },
  recipes: { path: "/recipes", screen: RecipesScreen },
  crypto: { path: "/crypto", screen: CryptoScreen },
});
