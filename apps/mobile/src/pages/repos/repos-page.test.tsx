import { render, screen } from "@testing-library/react-native";

import { queryClient, setDaemonCall, type TDaemonCall } from "@/lib/api";
import { AppProviders } from "@/providers/app-providers";

import { ReposPage } from "./repos-page";

describe("ReposPage", () => {
  afterEach(() => {
    queryClient.clear();
  });

  it("loads repos through the typed daemon client and lists them", async () => {
    const call: TDaemonCall = (name) => {
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
    };
    setDaemonCall(call);
    render(
      <AppProviders>
        <ReposPage />
      </AppProviders>,
    );
    expect(await screen.findByText("api")).toBeTruthy();
  });
});
