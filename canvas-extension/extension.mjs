import { createCanvas, joinSession } from "@github/copilot-sdk/extension";
import { createDrawioCanvas } from "./canvas.mjs";

await joinSession({ canvases: [createDrawioCanvas(createCanvas)] });
