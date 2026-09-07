# Creative Image Execution

Creative Image Execution is an internal, provider-neutral capability. It owns
generic authorized image-provider invocation and normalized execution evidence.

It is not Creative Studio V2, a second Creative Studio, an AI Background
Generator, or a replacement for Photo Scene.

- AI Story owns domain intent, narrative prompt compilation, continuity, and
  narrative QC.
- Creative Studio / Photo Scene owns its product workflow.
- Creative Image Execution owns generic bounded image-provider execution.

The V1 in-memory state store prevents duplicate calls only within one process.
It is not durable cross-process exactly-once authority. Durable execution would
require a separately authorized persistence design; this extraction adds none.

Provider usage or cost reported by an adapter is execution evidence only. It is
not EmberOS commercial pricing, charging, entitlement, or budget authority.

During the OpenAI adapter relocation, AI Story still owns its existing
caller-side paid authorization and translates its keyframe request through a
temporary compatibility wrapper. `CreativeImageExecutionService` is not yet on
that runtime path; final authorization ownership convergence belongs to the
separate AI Story rewiring ticket.
