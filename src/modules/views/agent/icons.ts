/** Small, consistent line icons; no platform-dependent emoji rendering. */
const paths = {
  book: "M12 5.5C9 3.5 5 3.5 3 4.5v14c3-1 6-1 9 1 3-2 6-2 9-1v-14c-2-1-6-1-9 1Zm0 0v14",
  plus: "M12 5v14M5 12h14",
  sidebar: "M4 4h16v16H4zM9 4v16",
  close: "m6 6 12 12M18 6 6 18",
  arrow: "M12 19V5m-6 6 6-6 6 6",
  stop: "M7 7h10v10H7z",
  shield: "m12 3 8 3v6c0 4-4 7-8 9-4-2-8-5-8-9V6l8-3Zm-4 9 3 3 5-6",
  chevron: "m8 10 4 4 4-4",
  settings: "M4 7h5m4 0h7M4 17h9m4 0h3M9 4v6m4 4v6",
  activity: "M4 5h16M4 12h16M4 19h10",
  conversation: "M4 4h16v12H9l-5 4V4Z",
  search: "M10 4a6 6 0 1 0 0 12 6 6 0 0 0 0-12Zm5 11 5 5",
  compare: "M5 4h5v16H5zM14 4h5v16h-5zM5 9h5m4 6h5",
  folder: "M3 7V5h7l2 3h9v12H3V7Z",
  local: "M4 4h16v12H4zM8 20h8m-4-4v4",
} as const;

export type AgentIcon = keyof typeof paths;

export function icon(doc: Document, name: AgentIcon) {
  const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "18");
  svg.setAttribute("height", "18");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.6");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.classList.add("agent-icon");
  const path = doc.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("d", paths[name]);
  svg.append(path);
  return svg;
}
