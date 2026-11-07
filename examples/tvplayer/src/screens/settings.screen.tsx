import { defineAction, defineScreen } from "@tenunjs/core";
import { Button, Column, Row, Scaffold, Text, TextField } from "@tenunjs/widgets";
import type { LoadResult } from "../layout";

/**
 * TN-196 settings screen: playlist URL entry through the EXISTING
 * TextField/IME path (TN-160 controlled input; on the TV the remote's
 * text mode drives it), loading via the media host's bounded fetchText.
 * The load result arrives as a pushed "loadResult" (the runtime owns
 * the async journey), so navigating away mid-load never loses it.
 */
export interface SettingsState {
  url: string;
  result: LoadResult | null;
}

export const SettingsScreen = defineScreen({
  name: "Settings",
  initialState: (): SettingsState => ({ url: "", result: null }),
  actions: {
    url: defineAction<SettingsState, string>({
      run({ input, state }) {
        state.url = input;
      },
    }),
    loadResult: defineAction<SettingsState, LoadResult>({
      run({ input, state }) {
        state.result = input;
      },
    }),
    load: defineAction<SettingsState, void>({
      run({ state, services }) {
        const url = state.url.trim();
        if (url === "") {
          state.result = { ok: false, message: "enter a playlist URL first" };
          return;
        }
        state.result = { ok: true, message: "loading…" };
        (services as { loadPlaylist?: (url: string) => void }).loadPlaylist?.(url);
      },
    }),
    back: defineAction<SettingsState, void>({
      run({ services }) {
        (services as { navigate?: (route: string) => void }).navigate?.("player");
      },
    }),
  },
  view({ state, actions }) {
    return (
      <Scaffold>
        <Column padding="lg" gap="lg">
          <Text variant="title" color="accent">
            Settings
          </Text>
          <Text variant="body" color="textDim">
            Playlist URL (m3u/m3u8) — fetched through the media host's bounded fetchText
            (GET only, 10 s timeout, 2 MB cap). Official free streams only; where you
            point the player is your choice.
          </Text>
          <TextField
            id="playlist-url"
            label="Playlist URL"
            placeholder="https://example.com/playlist.m3u"
            value={state.url}
            onChanged={actions.url}
          />
          <Row gap="md">
            <Button variant="primary" onPress={actions.load}>
              Load playlist
            </Button>
            <Button variant="secondary" onPress={actions.back}>
              Back to player
            </Button>
          </Row>
          {state.result && (
            <Text variant="body" color={state.result.ok ? "success" : "danger"}>
              {state.result.ok ? `Loaded: ${state.result.message}` : `Failed: ${state.result.message}`}
            </Text>
          )}
        </Column>
      </Scaffold>
    );
  },
});
