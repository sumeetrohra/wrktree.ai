import { fireEvent, render, screen } from "@testing-library/react-native";
import { I18nextProvider } from "react-i18next";

import { initI18n } from "@/shared/i18n/i18n";

import { ChatItemView } from "./chat-item-view";

const i18n = initI18n();
const wrap = (ui: React.JSX.Element) => render(<I18nextProvider i18n={i18n}>{ui}</I18nextProvider>);

describe("ChatItemView", () => {
  it("renders user, agent, plan and system items", () => {
    wrap(<ChatItemView item={{ kind: "user", id: "u", at: 0, text: "Fix the bug", attachments: [] }} />);
    expect(screen.getByText("Fix the bug")).toBeTruthy();
    wrap(<ChatItemView item={{ kind: "agent_text", id: "a", at: 0, text: "On it." }} />);
    expect(screen.getByText("On it.")).toBeTruthy();
    wrap(
      <ChatItemView
        item={{ kind: "plan", id: "p", at: 0, entries: [{ text: "Read README", status: "done" }] }}
      />,
    );
    expect(screen.getByText("● Read README")).toBeTruthy();
    wrap(<ChatItemView item={{ kind: "system", id: "s", at: 0, text: "Agent restarted", level: "warn" }} />);
    expect(screen.getByText("Agent restarted")).toBeTruthy();
  });

  it("collapses tool cards until tapped", () => {
    wrap(
      <ChatItemView
        item={{
          kind: "tool",
          id: "t",
          at: 0,
          title: "Edit app.ts",
          toolKind: "edit",
          status: "done",
          locations: ["src/app.ts"],
        }}
      />,
    );
    expect(screen.queryByText("src/app.ts")).toBeNull();
    fireEvent.press(screen.getByLabelText("Edit app.ts"));
    expect(screen.getByText("src/app.ts")).toBeTruthy();
  });
});
