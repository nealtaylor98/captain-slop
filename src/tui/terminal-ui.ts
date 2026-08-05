import { renderScreen, sidebarAgentAt, terminalFrame, type SupervisorViewModel } from "./index.js";

/** Minimal ANSI terminal owner with SGR mouse selection and keyboard fallback. */
export class TerminalUi {
  private input = "";
  private spinnerFrame = 0;
  private animation?: NodeJS.Timeout;
  constructor(
    private readonly view: SupervisorViewModel,
    private readonly sendToMain: (message: string) => void,
  ) {}
  start(): void {
    if (!process.stdin.isTTY || !process.stdout.isTTY)
      throw new Error("captain-slop requires an interactive Linux terminal.");
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdout.write("\x1b[?1049h\x1b[?1000h\x1b[?1006h\x1b[2J");
    this.draw();
    process.stdin.on("data", (chunk: Buffer) => this.key(chunk.toString("utf8")));
    this.animation = setInterval(() => {
      if (this.view.snapshot().awaitingResponse) {
        this.spinnerFrame = (this.spinnerFrame + 1) % 4;
        this.draw();
      }
    }, 120);
  }
  stop(): void {
    if (this.animation) clearInterval(this.animation);
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.stdout.write("\x1b[?1000l\x1b[?1006l\x1b[?1049l");
  }
  refresh(): void {
    this.draw();
  }
  private draw(): void {
    process.stdout.write(
      terminalFrame(
        renderScreen(
          this.view.snapshot(),
          process.stdout.columns || 100,
          process.stdout.rows || 30,
          this.input,
          true,
          ["◐", "◓", "◑", "◒"][this.spinnerFrame],
        ),
      ),
    );
  }
  private key(data: string): void {
    if (data === "\u0003" || data === "\u001b") {
      this.stop();
      process.exit(0);
    }
    const mouse = data.match(/^\x1b\[<(\d+);(\d+);(\d+)[mM]$/);
    if (mouse) {
      const button = Number(mouse[1]);
      if (button === 0) {
        const agent = sidebarAgentAt(
          this.view.snapshot(),
          Number(mouse[2]),
          Number(mouse[3]),
          process.stdout.columns || 100,
        );
        if (agent) this.view.select(agent.id);
        this.draw();
      }
      return;
    }
    if (data === "\r") {
      this.view.submit(this.input, this.sendToMain);
      this.input = "";
      this.draw();
      return;
    }
    if (data === "\u007f") this.input = this.input.slice(0, -1);
    else if (/^[^\x00-\x1f\x7f]+$/.test(data)) this.input += data;
    this.draw();
  }
}
