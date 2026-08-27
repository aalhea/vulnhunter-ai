import { fileURLToPath } from "node:url";

export const inject = ["agentPresets"];

/**
 * Register this package's presets/ directory as a read-only agent-preset
 * root so an installed bundle exposes 「漏洞挖掘模式」 without copying files
 * into the user's DSH home. Plain ESM JavaScript on purpose: the P0.5
 * milestone ships zero TypeScript and needs no build step.
 */
export function apply(ctx) {
	const root = fileURLToPath(new URL("../presets/", import.meta.url));
	const presets = ctx.get("agentPresets");
	if (!presets.resolvedRoots.some((entry) => entry.path === root)) {
		presets.resolvedRoots.unshift({ path: root, trust: "system" });
	}
}
