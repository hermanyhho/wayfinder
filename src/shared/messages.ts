import type { Fact, ViewData } from "./viewData";

export type HostMessage = { type: "view"; data: ViewData } | { type: "git"; id: string; facts: Fact[] };

export type WebviewMessage = { type: "ready" } | { type: "select"; id: string } | { type: "open"; id: string };
