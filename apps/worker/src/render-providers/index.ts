import {
  RenderProviderRegistry,
  type RenderProvider,
  type RenderProviderCapability,
} from "./contracts";
import { FFmpegRenderProvider } from "./ffmpeg-render-provider";

const registry = new RenderProviderRegistry();
registry.register(new FFmpegRenderProvider(), { makeDefault: true });

export function selectRenderProvider(
  requiredCapabilities: readonly RenderProviderCapability[]
): RenderProvider {
  const configuredProvider = process.env.RENDER_PROVIDER?.trim() || undefined;
  return registry.select(requiredCapabilities, configuredProvider);
}

export { registry as renderProviderRegistry };
