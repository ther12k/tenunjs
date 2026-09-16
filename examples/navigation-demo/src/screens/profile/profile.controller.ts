import { defineAction, defineController } from "@tenunjs/core";
import type { ProfileService, ProfileState } from "./profile.types";

export const ProfileController = defineController({
  name: "Profile",

  initialState: (): ProfileState => ({
    status: "idle",
    memberId: null,
    member: null,
    error: null,
  }),

  // Intended lifecycle hook: the runtime calls load() when the screen
  // mounts with route params (executable application model, M3).
  async load({ state, services, signal }) {
    if (state.memberId === null) return;
    await loadMember(state, state.memberId, services, signal);
  },

  actions: {
    showMember: defineAction<ProfileState, { memberId: string }>({
      async run({ input, state, services, signal }) {
        state.memberId = input.memberId;
        state.error = null;
        await loadMember(state, input.memberId, services, signal);
      },
    }),
  },
});

async function loadMember(
  state: ProfileState,
  memberId: string,
  services: Record<string, unknown>,
  signal: AbortSignal
): Promise<void> {
  const profiles = services.profiles as ProfileService | undefined;
  state.status = "loading";
  try {
    if (!profiles) {
      throw new Error("profiles service is not registered");
    }
    state.member = await profiles.fetch(memberId, { signal });
    state.status = "ready";
  } catch (error) {
    if (signal.aborted) return;
    state.status = "error";
    state.error =
      error instanceof Error ? error.message : "Profile unavailable.";
  }
}
