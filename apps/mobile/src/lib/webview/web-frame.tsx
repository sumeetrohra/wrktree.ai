import { WebView } from "react-native-webview";

export type TWebFrameProps = {
  /** Loaded once per mount: remount (a new `key`) to reload. */
  url: string;
  label: string;
  onLoad?: (() => void) | undefined;
};

/** A web page inside the app (Preview on phones). Its cookies stay in the WebView. */
export function WebFrame({ url, label, onLoad }: TWebFrameProps): React.JSX.Element {
  return (
    <WebView
      source={{ uri: url }}
      accessibilityLabel={label}
      className="bg-background flex-1"
      originWhitelist={["https://*", "http://*"]}
      sharedCookiesEnabled
      onLoadEnd={onLoad}
    />
  );
}
