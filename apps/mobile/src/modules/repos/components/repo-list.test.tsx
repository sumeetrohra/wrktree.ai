import { render, screen } from "@testing-library/react-native";
import { I18nextProvider } from "react-i18next";

import { initI18n } from "@/shared/i18n/i18n";

import { RepoList } from "./repo-list";

const i18n = initI18n();

describe("RepoList", () => {
  it("renders each repo with its default branch", () => {
    render(
      <I18nextProvider i18n={i18n}>
        <RepoList
          hostId="local"
          repos={[
            {
              id: "repo_01J9Z8Y7X6W5V4T3S2R1Q0P9N8",
              path: "/src/shop",
              name: "shop",
              defaultBase: "main",
              createdAt: 0,
            },
          ]}
        />
      </I18nextProvider>,
    );
    expect(screen.getByText("shop")).toBeTruthy();
    expect(screen.getByText("main")).toBeTruthy();
  });

  it("explains how to add a repo when there are none", () => {
    render(
      <I18nextProvider i18n={i18n}>
        <RepoList hostId="local" repos={[]} />
      </I18nextProvider>,
    );
    expect(screen.getByText(/No repositories yet/)).toBeTruthy();
  });
});
