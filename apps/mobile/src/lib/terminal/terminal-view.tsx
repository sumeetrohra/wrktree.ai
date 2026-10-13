import { useState } from "react";
import { WebView } from "react-native-webview";

import { TerminalBridge } from "./terminal-bridge.utils";
import { TERMINAL_PAGE } from "./terminal-page.constants";
import type { TTerminalViewProps } from "./terminal.types";

/** A terminal on phones: xterm.js in a WebView. Remount (a new `key`) for another terminal. */
export function TerminalView(props: TTerminalViewProps): React.JSX.Element {
  const [bridge] = useState(() => new TerminalBridge(props));
  return (
    <WebView
      ref={(view) => {
        bridge.attach(view);
        return () => {
          bridge.detach();
        };
      }}
      source={{ html: TERMINAL_PAGE, baseUrl: "https://cdn.jsdelivr.net/" }}
      accessibilityLabel={props.label}
      className="flex-1"
      originWhitelist={["https://*"]}
      keyboardDisplayRequiresUserAction={false}
      hideKeyboardAccessoryView
      onMessage={(e) => {
        bridge.message(e.nativeEvent.data);
      }}
    />
  );
}
