export interface TranscriptEntry {
  kind: "user" | "agent" | "status";
  text: string;
}
