import qrcode from "qrcode-terminal";

/** A QR code drawn with block characters, for a phone to scan off the terminal. */
export function qrText(text: string): Promise<string> {
  return new Promise((resolve) => {
    qrcode.generate(text, { small: true }, resolve);
  });
}
