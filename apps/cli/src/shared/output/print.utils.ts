/** All CLI output goes through these two functions (G4: no console). */
export function print(text: string): void {
  process.stdout.write(`${text}\n`);
}

export function printError(text: string): void {
  process.stderr.write(`${text}\n`);
}
