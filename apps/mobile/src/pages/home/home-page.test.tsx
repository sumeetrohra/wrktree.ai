import type { TCommandName, TEvtFrame } from "@agentdeck/protocol";
import { screen } from "@testing-library/react-native";
import { renderRouter } from "expo-router/testing-library";

import { queryClient, setConnection, type IDaemonConnection } from "@/lib/api";
import { AppProviders } from "@/providers/app-providers";

import { HomePage } from "./home-page";

/** A host that answers `workspace.overview` and nothing else. */
function fakeConnection(): IDaemonConnection & { start(): void } {
  return {
    status: "online",
    start: () => undefined,
    stop: () => undefined,
    onEvent: (_fn: (e: TEvtFrame) => void) => () => undefined,
    onStatus: () => () => undefined,
    upload: () => Promise.reject(new Error("no uploads")),
    call: (name: TCommandName) => {
      expect(name).toBe("workspace.overview");
      return Promise.resolve({
        host: { deviceId: null, name: "Test machine" },
        repos: [
          {
            id: "repo_01J9Z8Y7X6W5V4T3S2R1Q0P9N8",
            path: "/src/api",
            name: "api",
            defaultBase: "main",
            createdAt: 0,
          },
        ],
        worktrees: [],
        chats: [],
        profiles: [],
      }) as never;
    },
  };
}

describe("HomePage", () => {
  afterEach(() => {
    queryClient.clear();
  });

  it("lists every computer's repos, with its connection status", async () => {
    setConnection("d_test", fakeConnection());
    // Inside a real router: the page sets its own screen options.
    renderRouter({ index: HomePage }, { initialUrl: "/", wrapper: AppProviders });
    expect(await screen.findByText("api")).toBeTruthy();
    expect(screen.getAllByText("Test machine").length).toBeGreaterThan(0);
    expect(screen.getByText("online")).toBeTruthy();
  });
});
