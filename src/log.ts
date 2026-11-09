import fs from "node:fs";

export type LogFields = Record<string, string | number | boolean>;

export type LogEvent = {
  ts: string;
  component: string;
  message: string;
  fields: LogFields;
};

export class Logger {
  readonly events: LogEvent[] = [];

  constructor(
    private readonly write: (line: string) => void = (line) => {
      fs.writeSync(1, `${line}\n`);
    },
  ) {}

  log(component: string, message: string, fields: LogFields = {}): LogEvent {
    const event: LogEvent = {
      ts: new Date().toISOString(),
      component,
      message,
      fields,
    };
    this.events.push(event);
    const extra = Object.entries(fields)
      .map(([key, value]) => `${key}=${formatField(value)}`)
      .join("  ");
    this.write(
      `${event.ts}  ${component.padEnd(7)}  ${message}${extra ? `  ${extra}` : ""}`,
    );
    return event;
  }
}

function formatField(value: string | number | boolean): string {
  const text = String(value);
  return /[\s"]/.test(text) ? JSON.stringify(text) : text;
}

export function redactSecret(value: string): string {
  if (value.length <= 8) return "***";
  return `${value.slice(0, 8)}…`;
}
