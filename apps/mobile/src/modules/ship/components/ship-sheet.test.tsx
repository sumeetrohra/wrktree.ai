import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { I18nextProvider } from "react-i18next";

import { initI18n } from "@/shared/i18n/i18n";

import { ShipSheet, type TShipSheetProps } from "./ship-sheet";

const i18n = initI18n();
const status = {
  branch: "notes",
  upstream: null,
  ahead: 0,
  behind: 0,
  dirty: 1,
  lastCommit: { sha: "abc", subject: "Initial commit", at: 0 },
  hasRemote: true,
};

function sheet(props: Partial<TShipSheetProps>) {
  const onAction = jest.fn();
  const onDraft = jest.fn(() => Promise.resolve({ title: "Update the notes", body: "Adds NOTES.md" }));
  render(
    <I18nextProvider i18n={i18n}>
      <ShipSheet
        status={status}
        pr={null}
        prError={null}
        busy={false}
        error={null}
        canDraft
        drafting={false}
        onAction={onAction}
        onDraft={onDraft}
        {...props}
      />
    </I18nextProvider>,
  );
  return { onAction, onDraft };
}

describe("ShipSheet", () => {
  it("commits with the typed message", () => {
    const { onAction } = sheet({});
    fireEvent.changeText(screen.getByPlaceholderText("Commit message"), "Add notes");
    fireEvent.press(screen.getByText("Commit all changes"));
    expect(onAction).toHaveBeenCalledWith({ kind: "commit", message: "Add notes" });
  });

  it("after a push: the agent drafts the PR, then it is created as a draft", async () => {
    const { onAction, onDraft } = sheet({ status: { ...status, dirty: 0, upstream: "origin/notes" } });
    expect(screen.queryByText("Push")).toBeNull();
    fireEvent.press(screen.getByText("Draft with the agent"));
    expect(onDraft).toHaveBeenCalled();
    await waitFor(() => {
      expect(screen.getByDisplayValue("Update the notes")).toBeTruthy();
    });
    fireEvent.press(screen.getByText("Ready for review"));
    fireEvent.press(screen.getByText("Create pull request"));
    expect(onAction).toHaveBeenCalledWith({
      kind: "createPr",
      title: "Update the notes",
      body: "Adds NOTES.md",
      draft: true,
    });
  });

  it("shows an open PR with Merge, and a repo without a remote merges into base", () => {
    const pr = { number: 7, url: "https://github.com/x/y/pull/7", state: "open" as const, draft: false };
    const { onAction } = sheet({ status: { ...status, dirty: 0, upstream: "origin/notes" }, pr });
    expect(screen.getByText("Pull request #7")).toBeTruthy();
    fireEvent.press(screen.getByText("Squash and merge"));
    expect(onAction).toHaveBeenCalledWith({ kind: "mergePr", method: "squash" });
  });

  it("offers merge into base without a remote, and shows why gh can't be used", () => {
    sheet({ status: { ...status, dirty: 0, ahead: 2, hasRemote: false } });
    expect(screen.getByText("Merge into the base branch")).toBeTruthy();
    expect(screen.queryByText("Push")).toBeNull();
  });
});
