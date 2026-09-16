import { defineScreen } from "@tenunjs/core";
import {
  AppBar,
  Button,
  Card,
  Column,
  Scaffold,
  Text,
} from "@tenunjs/widgets";
import { ProfileController } from "./profile.controller";

export const ProfileScreen = defineScreen({
  controller: ProfileController,

  view({ state, actions }) {
    return (
      <Scaffold appBar={<AppBar title="Profile" />}>
        <Column padding="lg" gap="md">
          {state.status === "idle" || state.status === "loading" ? (
            <Card padding="lg" radius="md" background="surfaceRaised">
              <Text variant="body">Loading profile…</Text>
            </Card>
          ) : null}

          {state.status === "error" ? (
            <Card
              padding="lg"
              radius="md"
              background="surfaceRaised"
              semantics={{ role: "alert", label: "Profile failed to load" }}
            >
              <Column gap="sm">
                <Text variant="title">Profile unavailable</Text>
                <Text variant="body">{state.error ?? "Profile unavailable."}</Text>
                {state.memberId !== null ? (
                  <Button
                    variant="secondary"
                    onPress={() =>
                      actions.showMember({ memberId: state.memberId as string })
                    }
                  >
                    Retry
                  </Button>
                ) : null}
              </Column>
            </Card>
          ) : null}

          {state.status === "ready" && state.member !== null ? (
            <Card padding="lg" radius="lg" background="surfaceRaised">
              <Column gap="sm">
                <Text variant="display">{state.member.name}</Text>
                <Text variant="title">{state.member.role}</Text>
                <Text variant="body">
                  {state.member.team} team · {state.member.id}
                </Text>
                <Button
                  variant="secondary"
                  onPress={() =>
                    actions.showMember({ memberId: state.member!.id })
                  }
                >
                  Refresh
                </Button>
              </Column>
            </Card>
          ) : null}
        </Column>
      </Scaffold>
    );
  },
});
