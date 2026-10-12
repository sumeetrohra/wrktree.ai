import type { TCommandName, TEvtFrame } from "@agentdeck/protocol";
import { screen } from "@testing-library/react-native";
import { renderRouter } from "expo-router/testing-library";

import { queryClient, setConnection, type IDaemonConnection } from "@/lib/api";
import { AppProviders } from "@/providers/app-providers";

import { HomePage } from "./home-page";

/** A connection that answers `repo.list` and nothing else. */
function fakeConnection(): IDaemonConnection & { start(): void } {
  return {
    status: "online",
    start: () => undefined,
    stop: () => undefined,
    onEvent: (_fn: (e: TEvtFrame) => void) => () => undefined,
    onStatus: () => () => undefined,
    upload: () => Promise.reject(new Error("no uploads")),
    call: (name: TCommandName) => {
      expect(name).toBe("repo.list");
      return Promise.resolve([
        {
          id: "repo_01J9Z8Y7X6W5V4T3S2R1Q0P9N8",
          path: "/src/api",
          name: "api",
          defaultBase: "main",
          createdAt: 0,
        },
      ]) as never;
    },
  };
}

describe("HomePage", () => {
  afterEach(() => {
    queryClient.clear();
  });

  it("lists repos from the paired machine, with its connection status", async () => {
    setConnection(fakeConnection());
    // Inside a real router: the page sets its own screen options.
    renderRouter({ index: HomePage }, { initialUrl: "/", wrapper: AppProviders });
    expect(await screen.findByText("api")).toBeTruthy();
    expect(screen.getByText("Test machine · online")).toBeTruthy();
  });
});
