import { requestHash } from "@ceo-agent/shared";
import type {
  ProviderAdapter,
  ProviderCapabilityDeclaration,
} from "../provider-adapters/contracts";

export interface ProviderAdapterRegistrySnapshot {
  readonly declarations: readonly ProviderCapabilityDeclaration[];
  readonly snapshotHash: string;
}

function cloneDeclaration(
  declaration: ProviderCapabilityDeclaration
): ProviderCapabilityDeclaration {
  return structuredClone(declaration);
}

function freeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) freeze(child);
  }
  return value;
}

function identity(declaration: ProviderCapabilityDeclaration): string {
  return [
    declaration.providerId,
    declaration.adapterVersion,
    declaration.capabilityId,
  ].join(":");
}

function compareDeclaration(
  left: ProviderCapabilityDeclaration,
  right: ProviderCapabilityDeclaration
): number {
  return (
    left.providerId.localeCompare(right.providerId) ||
    left.adapterVersion.localeCompare(right.adapterVersion) ||
    left.capabilityId.localeCompare(right.capabilityId)
  );
}

export class ProviderAdapterRegistry {
  private readonly declarations = new Map<string, ProviderCapabilityDeclaration>();

  register(adapter: Pick<ProviderAdapter, "providerId" | "adapterVersion" | "capabilities">): void {
    const declarations = [...adapter.capabilities()].sort(compareDeclaration);
    if (declarations.length === 0) throw new Error("Adapter must declare capabilities");

    for (const declaration of declarations) {
      if (
        declaration.providerId !== adapter.providerId ||
        declaration.adapterVersion !== adapter.adapterVersion
      ) {
        throw new Error("Adapter identity does not match capability declaration");
      }
      const key = identity(declaration);
      if (this.declarations.has(key)) {
        throw new Error(`Provider Adapter declaration already registered: ${key}`);
      }
    }
    for (const declaration of declarations) {
      this.declarations.set(
        identity(declaration),
        freeze(cloneDeclaration(declaration)) as ProviderCapabilityDeclaration
      );
    }
  }

  get(
    providerId: string,
    adapterVersion: string
  ): readonly ProviderCapabilityDeclaration[] {
    return freeze(
      [...this.declarations.values()]
        .filter(
          (item) =>
            item.providerId === providerId && item.adapterVersion === adapterVersion
        )
        .sort(compareDeclaration)
        .map(cloneDeclaration)
    ) as readonly ProviderCapabilityDeclaration[];
  }

  async snapshot(): Promise<ProviderAdapterRegistrySnapshot> {
    const declarations = [...this.declarations.values()]
      .sort(compareDeclaration)
      .map(cloneDeclaration);
    return freeze({
      declarations,
      snapshotHash: await requestHash(declarations),
    }) as ProviderAdapterRegistrySnapshot;
  }
}
