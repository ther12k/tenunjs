import { describe, expect, test } from "bun:test";
import { DIRECTORY } from "../src/data/directory";
import { routes } from "../src/routes";
import { HomeScreen } from "../src/screens/home.screen";
import { createDirectoryService } from "../src/screens/profile/profile.service";
import { ProfileScreen } from "../src/screens/profile/profile.view";
import { mountScreen } from "@tenunjs-examples/test-support";

function profileHarness() {
  return mountScreen(ProfileScreen, {
    services: { profiles: createDirectoryService(DIRECTORY) },
  });
}

describe("HomeScreen", () => {
  test("filters the directory by team", () => {
    const home = mountScreen(HomeScreen);
    home.actions.setTeam("Loom");
    expect(home.state.team).toBe("Loom");
    expect(home.render()).not.toBeNull();
  });
});

describe("ProfileScreen", () => {
  test("loads a member through the injected service", async () => {
    const profile = profileHarness();
    expect(profile.state.status).toBe("idle");

    await profile.press("showMember", { memberId: "rina-01" });

    expect(profile.state.status).toBe("ready");
    expect(profile.state.member?.name).toBe("Rina Pratiwi");
    expect(profile.render()).not.toBeNull();
  });

  test("unknown members land in the declared error state", async () => {
    const profile = profileHarness();

    await profile.press("showMember", { memberId: "ghost-99" });

    expect(profile.state.status).toBe("error");
    expect(profile.state.error).toContain("unknown member");
    expect(profile.render()).not.toBeNull();
  });
});

describe("routes", () => {
  test("typed builders produce frozen route instances", () => {
    const instance = routes.profile({ memberId: "rina-01" });
    expect(instance.path).toBe("/profile/:memberId");
    expect(instance.params).toEqual({ memberId: "rina-01" });
    expect(Object.isFrozen(instance.params)).toBe(true);
    expect(routes.home().path).toBe("/");
  });
});
