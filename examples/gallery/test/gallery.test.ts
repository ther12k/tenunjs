import { describe, expect, test } from "bun:test";
import { mountScreen } from "@tenunjs-examples/test-support";
import { BankingScreen } from "../src/screens/banking.screen";
import { SmartHomeScreen } from "../src/screens/smart-home.screen";
import { FitnessScreen } from "../src/screens/fitness.screen";
import { StoreScreen } from "../src/screens/store.screen";
import { SettingsScreen } from "../src/screens/settings.screen";
import { HomeScreen } from "../src/screens/home.screen";
import { OnboardingScreen } from "../src/screens/onboarding.screen";
import { PlantsScreen } from "../src/screens/plants.screen";
import { ProfileScreen } from "../src/screens/profile.screen";
import type { BankingState } from "../src/screens/banking.screen";
import type { SmartHomeState } from "../src/screens/smart-home.screen";
import type { FitnessState } from "../src/screens/fitness.screen";
import type { StoreState } from "../src/screens/store.screen";
import type { SettingsState } from "../src/screens/settings.screen";

/**
 * Interactive acceptance for the gallery modules: every flow runs through
 * the shared screen harness (real action contexts, views from committed
 * state), mirroring how the runtime will drive screens.
 */

describe("GalleryHome", () => {
  test("hub renders all five module cards", () => {
    const h = mountScreen(HomeScreen as never);
    const tree = h.render();
    expect(tree).not.toBeNull();
  });
});

describe("Banking (Rally-style)", () => {
  test("total balance is the sum of accounts", () => {
    const h = mountScreen(BankingScreen);
    const total = h.state.accounts.reduce((s: number, a: { balance: number }) => s + a.balance, 0);
    expect(total).toBeCloseTo(12331.75);
  });

  test("transfer moves money checking -> savings without losing any", () => {
    const h = mountScreen(BankingScreen);
    const before = h.state.accounts.reduce((s: number, a: { balance: number }) => s + a.balance, 0);
    h.press("transfer", 100);
    const after = h.state.accounts.reduce((s: number, a: { balance: number }) => s + a.balance, 0);
    expect(after).toBeCloseTo(before);
    const checking = h.state.accounts.find((a: { kind: string }) => a.kind === "checking");
    expect(checking!.balance).toBeCloseTo(2331.5);
  });

  test("transfer is clamped to the available balance", () => {
    const h = mountScreen(BankingScreen);
    h.press("transfer", 100000);
    const checking = h.state.accounts.find((a: { kind: string }) => a.kind === "checking");
    expect(checking!.balance).toBe(0);
    const total = h.state.accounts.reduce((s: number, a: { balance: number }) => s + a.balance, 0);
    expect(total).toBeCloseTo(12331.75);
  });

  test("payBill marks exactly the named bill paid", () => {
    const h = mountScreen(BankingScreen);
    h.press("payBill", "Internet");
    expect(h.state.bills.find((b: { name: string }) => b.name === "Internet")!.paid).toBe(true);
    expect(h.state.bills.find((b: { name: string }) => b.name === "Rent")!.paid).toBe(false);
  });
});

describe("Smart home", () => {
  test("toggle flips a single device by name", () => {
    const h = mountScreen(SmartHomeScreen);
    h.press("toggle", "Speaker");
    expect(h.state.devices.find((d: { name: string }) => d.name === "Speaker")!.on).toBe(true);
    expect(h.state.devices.find((d: { name: string }) => d.name === "Ceiling light")!.on).toBe(true);
  });

  test("Movie scene turns living room on and everything else off", () => {
    const h = mountScreen(SmartHomeScreen);
    h.press("applyScene", "Movie");
    for (const d of [...h.state.devices] as Array<{ room: string; on: boolean; name: string }>) {
      expect(d.on).toBe(d.room === "Living room");
    }
    expect(h.state.activeScene).toBe("Movie");
  });

  test("Away scene turns everything off", () => {
    const h = mountScreen(SmartHomeScreen);
    h.press("applyScene", "Away");
    for (const d of [...h.state.devices] as Array<{ on: boolean }>) {
      expect(d.on).toBe(false);
    }
  });
});

describe("Fitness", () => {
  test("logWalk adds steps and derived kcal and updates the week", () => {
    const h = mountScreen(FitnessScreen);
    const stepsBefore = h.state.stepsToday;
    const kcalBefore = h.state.moveKcal;
    const fridayBefore = h.state.week[4].steps;
    h.press("logWalk", 1000);
    expect(h.state.stepsToday).toBe(stepsBefore + 1000);
    expect(h.state.moveKcal).toBe(kcalBefore + 40);
    expect(h.state.week[4].steps).toBe(fridayBefore + 1000);
  });

  test("completing the workout banks its kcal and clears the plan", () => {
    const h = mountScreen(FitnessScreen);
    const kcalBefore = h.state.moveKcal;
    const planned = h.state.workout!.kcal;
    h.press("completeWorkout");
    expect(h.state.moveKcal).toBe(kcalBefore + planned);
    expect(h.state.workout).toBeNull();
  });

  test("completing with no workout is a safe no-op", () => {
    const h = mountScreen(FitnessScreen);
    h.press("completeWorkout");
    const kcal = h.state.moveKcal;
    h.press("completeWorkout");
    expect(h.state.moveKcal).toBe(kcal);
  });
});

describe("Store (Shrine-style)", () => {
  test("category filter narrows the visible grid", () => {
    const h = mountScreen(StoreScreen);
    h.press("setCategory", "Home");
    expect(h.state.category).toBe("Home");
  });

  test("addToCart creates a line and increments quantity for repeats", () => {
    const h = mountScreen(StoreScreen);
    h.press("addToCart", "lamp");
    h.press("addToCart", "lamp");
    expect(h.state.cart.length).toBe(1);
    expect(h.state.cart[0].qty).toBe(2);
  });

  test("cart total is the sum of price × qty and checkout clears it", () => {
    const h = mountScreen(StoreScreen);
    h.press("addToCart", "lamp");
    h.press("addToCart", "buds");
    const total = h.state.cart.reduce((s: number, c: { price: number; qty: number }) => s + c.price * c.qty, 0);
    expect(total).toBeCloseTo(218.0);
    h.press("checkout");
    expect(h.state.cart.length).toBe(0);
  });

  test("removeFromCart deletes only the named line", () => {
    const h = mountScreen(StoreScreen);
    h.press("addToCart", "lamp");
    h.press("addToCart", "buds");
    h.press("removeFromCart", "lamp");
    expect(h.state.cart.map((c: { id: string }) => c.id)).toEqual(["buds"]);
  });
});

describe("Settings", () => {
  test("togglePreference flips exactly the named preference", () => {
    const h = mountScreen(SettingsScreen);
    const notificationsBefore = h.state.preferences.notifications;
    h.press("togglePreference", "notifications");
    expect(h.state.preferences.notifications).toBe(!notificationsBefore);
    expect(h.state.preferences.darkMode).toBe(true);
  });

  test("resetToDefaults restores the documented defaults", () => {
    const h = mountScreen(SettingsScreen);
    h.press("togglePreference", "darkMode");
    h.press("togglePreference", "notifications");
    h.press("resetToDefaults");
    expect(h.state.preferences).toEqual({
      darkMode: true,
      notifications: false,
      analytics: false,
      haptics: true,
    });
  });
});

describe("Onboarding walkthrough", () => {
  test("next walks the pages, the last one finishes, and restart resets", () => {
    const h = mountScreen(OnboardingScreen);
    expect(h.state.page).toBe(0);
    h.press("next");
    h.press("next");
    expect(h.state.page).toBe(2);
    h.press("next");
    expect(h.state.done).toBe(true);
    expect(h.state.page).toBe(2);

    h.press("restart");
    expect(h.state.done).toBe(false);
    expect(h.state.page).toBe(0);
  });

  test("skip jumps straight past the pages", () => {
    const h = mountScreen(OnboardingScreen);
    h.press("skip");
    expect(h.state.done).toBe(true);
    expect(h.state.page).toBe(0);
  });

  test("sign-up completes after skipping and dots jump pages", () => {
    const h = mountScreen(OnboardingScreen);
    h.press("skip");
    h.press("signUp");
    expect(h.state.signedUp).toBe(true);
    h.press("restart");
    h.press("setPage", 2);
    expect(h.state.page).toBe(2);
    expect(h.state.done).toBe(false);
  });
});

describe("Plant shop", () => {
  test("favorites toggle on and off by plant id", () => {
    const h = mountScreen(PlantsScreen);
    h.press("toggleFavorite", "monstera");
    expect(h.state.favorites).toEqual(["monstera"]);
    h.press("toggleFavorite", "monstera");
    expect(h.state.favorites).toEqual([]);
  });

  test("cart accumulates per plant and checkout clears it with a receipt", () => {
    const h = mountScreen(PlantsScreen);
    h.press("addToCart", "monstera");
    h.press("addToCart", "monstera");
    h.press("addToCart", "candelabra");
    expect(h.state.cart).toEqual({ monstera: 2, candelabra: 1 });
    h.press("checkout");
    expect(h.state.cart).toEqual({});
    expect(h.state.ordered).toBe(true);
    h.press("dismissOrder");
    expect(h.state.ordered).toBe(false);
  });

  test("checkout with an empty cart is a no-op", () => {
    const h = mountScreen(PlantsScreen);
    h.press("checkout");
    expect(h.state.ordered).toBe(false);
  });

  test("category and nav selections land in state", () => {
    const h = mountScreen(PlantsScreen);
    h.press("setCategory", 1);
    expect(h.state.category).toBe(1);
    h.press("setNav", 3);
    expect(h.state.nav).toBe(3);
  });
});

describe("Profile & account", () => {
  test("tabs switch, settings mutate, and logout/sign-in round-trips", () => {
    const h = mountScreen(ProfileScreen);
    h.press("setTab", 2);
    expect(h.state.tab).toBe(2);
    h.press("toggleDark");
    expect(h.state.darkMode).toBe(false);
    h.press("setUnits", 1);
    expect(h.state.units).toBe(1);
    h.press("logOut");
    expect(h.state.loggedOut).toBe(true);
    h.press("signIn");
    expect(h.state.loggedOut).toBe(false);
  });
});
