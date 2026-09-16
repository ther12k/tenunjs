import type { ProfileService, TeamMember } from "./profile.types";

/**
 * In-memory stand-in for the production profile capability. The seam,
 * not the implementation, is the point: the controller only knows the
 * ProfileService interface from profile.types.ts.
 */
export function createDirectoryService(
  members: readonly TeamMember[]
): ProfileService {
  return {
    async fetch(memberId, { signal }) {
      if (signal.aborted) {
        throw new Error("aborted");
      }
      const member = members.find((candidate) => candidate.id === memberId);
      if (!member) {
        throw new Error(`unknown member: ${memberId}`);
      }
      return member;
    },
  };
}
