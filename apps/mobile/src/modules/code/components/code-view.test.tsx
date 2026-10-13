import { fireEvent, render, screen } from "@testing-library/react-native";

import { CodeView } from "./code-view";

const lines = Array.from({ length: 5000 }, (_, i) => `const line${String(i + 1)} = ${String(i + 1)};`);

describe("CodeView", () => {
  // Jest has no viewport to measure, so FlashList renders a generous first batch rather than one
  // screen; what matters here is that the file isn't rendered whole up front.
  it("doesn't render a 5,000-line file whole", () => {
    render(<CodeView lines={lines} selection={null} onSelect={jest.fn()} />);
    expect(screen.getByText("const line1 = 1;", { exact: false })).toBeTruthy();
    expect(screen.queryByText("const line3000 = 3000;", { exact: false })).toBeNull();
    expect(screen.queryByText("const line5000 = 5000;", { exact: false })).toBeNull();
  });

  it("selects a line on tap and extends on long-press", () => {
    const onSelect = jest.fn();
    render(<CodeView lines={lines.slice(0, 20)} selection={{ line: 2, endLine: 2 }} onSelect={onSelect} />);
    fireEvent.press(screen.getByText("const line3 = 3;", { exact: false }));
    fireEvent(screen.getByText("const line5 = 5;", { exact: false }), "longPress");
    fireEvent.press(screen.getByText("const line2 = 2;", { exact: false }));
    expect(onSelect.mock.calls).toEqual([[{ line: 3, endLine: 3 }], [{ line: 2, endLine: 5 }], [null]]);
  });
});
