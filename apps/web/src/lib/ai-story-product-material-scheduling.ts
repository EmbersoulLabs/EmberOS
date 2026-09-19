import { SceneSchedulingCoordinator, type SceneSchedulingCoordinatorDependencies } from "@ceo-agent/agents";
import { resolveCurrentSceneProductMaterialForScheduling } from "@/lib/ai-story-product-material-runtime";

/** Normal application scheduling always resolves exact current Product material. */
export function createCanonicalProductMaterialSchedulingCoordinator(
  router: SceneSchedulingCoordinatorDependencies["router"],
): SceneSchedulingCoordinator {
  return new SceneSchedulingCoordinator({
    router,
    productMaterialSelectionResolver: resolveCurrentSceneProductMaterialForScheduling,
  });
}
