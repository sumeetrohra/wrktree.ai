export interface IMailer {
  sendCode(to: string, code: string): Promise<void>;
}
