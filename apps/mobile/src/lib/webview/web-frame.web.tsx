export type TWebFrameProps = {
  /** Loaded once per mount: remount (a new `key`) to reload. */
  url: string;
  label: string;
  onLoad?: (() => void) | undefined;
};

/** The web build shows the page in an iframe; previews are same-site with the app, so its cookie works. */
export function WebFrame({ url, label, onLoad }: TWebFrameProps): React.JSX.Element {
  return <iframe src={url} title={label} onLoad={onLoad} className="bg-background h-full w-full border-0" />;
}
