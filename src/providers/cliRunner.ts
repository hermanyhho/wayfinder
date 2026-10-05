import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import type { CliLogin, CloudCli } from "../ai/cloudCli";

const MAX_OUTPUT_BYTES = 20 * 1024 * 1024;

const lastLine = (text: string) => text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).pop();

const isMissingCommand = (error: unknown) => (error as NodeJS.ErrnoException | null)?.code === "ENOENT";

export function cliLoginState(cli: CloudCli, timeoutMs: number): Promise<CliLogin> {
  return new Promise((resolve) => {
    execFile(cli.command, cli.loginCheckArgs, { timeout: timeoutMs }, (error) => {
      if (!error) resolve("loggedIn");
      else if (isMissingCommand(error)) resolve("missing");
      else resolve("loggedOut");
    });
  });
}

export function runCliScan(cli: CloudCli, prompt: string, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    // running outside the workspace stops the CLI from loading the project's CLAUDE.md or AGENTS.md
    const child = execFile(cli.command, cli.scanArgs, { cwd: tmpdir(), signal, maxBuffer: MAX_OUTPUT_BYTES }, (error, stdout, stderr) => {
      if (signal.aborted) return reject(signal.reason);
      // a CLI can exit with an error and still print output that says what went wrong, so the reply reader gets it
      if (error && (isMissingCommand(error) || !stdout.trim())) return reject(new Error(lastLine(stderr) || error.message));
      try {
        resolve(cli.readReply(stdout));
      } catch (readError) {
        const stderrLine = error ? lastLine(stderr) : undefined;
        reject(stderrLine && readError instanceof Error ? new Error(`${readError.message} (${stderrLine})`) : readError);
      }
    });
    // the CLI can exit before reading the prompt, and the exit error above already reports that
    child.stdin?.on("error", () => undefined);
    child.stdin?.end(cli.scanInput(prompt));
  });
}
