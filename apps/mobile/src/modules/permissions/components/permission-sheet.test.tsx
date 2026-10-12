import { fireEvent, render, screen } from "@testing-library/react-native";
import { I18nextProvider } from "react-i18next";

import { initI18n } from "@/shared/i18n/i18n";

import { PermissionSheet } from "./permission-sheet";

const i18n = initI18n();
const request = {
  requestId: "r1",
  toolCallId: "t1",
  title: "Edit app.ts",
  toolKind: "edit",
  locations: ["src/app.ts"],
  options: [],
  at: 0,
};

describe("PermissionSheet", () => {
  it("answers allow once, always and deny", () => {
    const onRespond = jest.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <PermissionSheet request={request} busy={false} onRespond={onRespond} />
      </I18nextProvider>,
    );
    expect(screen.getByText("Edit app.ts")).toBeTruthy();
    fireEvent.press(screen.getByText("Allow once"));
    fireEvent.press(screen.getByText("Always"));
    fireEvent.press(screen.getByText("Deny"));
    expect(onRespond.mock.calls).toEqual([["allow_once"], ["allow_always"], ["deny"]]);
  });

  it("denies with a message the agent will read", () => {
    const onRespond = jest.fn();
    render(
      <I18nextProvider i18n={i18n}>
        <PermissionSheet request={request} busy={false} onRespond={onRespond} />
      </I18nextProvider>,
    );
    fireEvent.press(screen.getByText("Deny + message"));
    fireEvent.changeText(
      screen.getByPlaceholderText("Tell the agent what to do instead"),
      "Use docs/ instead",
    );
    fireEvent.press(screen.getByText("Deny and send"));
    expect(onRespond).toHaveBeenCalledWith("deny", "Use docs/ instead");
  });
});
