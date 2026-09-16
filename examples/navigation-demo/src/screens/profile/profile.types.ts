export interface TeamMember {
  id: string;
  name: string;
  role: string;
  team: string;
}

export interface ProfileState {
  status: "idle" | "loading" | "ready" | "error";
  memberId: string | null;
  member: TeamMember | null;
  error: string | null;
}

/**
 * Capability seam for profile data. The production implementation is a
 * native module or typed network client; the example ships an in-memory
 * stand-in so the controller's async flow is fully exercisable today.
 */
export interface ProfileService {
  fetch(memberId: string, options: { signal: AbortSignal }): Promise<TeamMember>;
}
