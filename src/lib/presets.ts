import type { Intent } from "./types";

export const PRESETS: { label: string; text: string; intent: Intent }[] = [
  {
    label: "Clean up stale branches",
    text: "Delete every branch with no commits in the last 30 days",
    intent: { kind: "github.delete_branches", olderThanDays: 30, onlyMerged: false, summary: "Delete all branches whose last commit is 30+ days old" },
  },
  {
    label: "Only merged stale branches",
    text: "Delete branches older than 30 days that are already merged",
    intent: { kind: "github.delete_branches", olderThanDays: 30, onlyMerged: true, summary: "Delete merged branches whose last commit is 30+ days old" },
  },
  {
    label: "Refund the outage",
    text: "Refund everyone who paid for the Pro plan during the November outage window",
    intent: { kind: "stripe.refund", descriptionContains: "outage window", percent: 100, summary: "Fully refund every charge whose description mentions the outage window" },
  },
];
