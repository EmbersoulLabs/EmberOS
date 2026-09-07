# AI Story keyframe paid authorization V1

`ai-story-keyframe-paid-authorization.v1` is an immutable subordinate AI Story authority. It records the explicit authenticated action “authorize this frozen Scene keyframe preparation for one paid image-generation Provider call.” It is not a new aggregate root, commercial ledger, Provider-attempt ledger, or Creative Image authority.

The server action boundary is `AiStoryKeyframePaidAuthorizationService.authorizeSceneKeyframePaidGeneration`. The caller must obtain `actorUserId` from the authenticated server session and provide a stable explicit-confirmation request ID. The service, not the client, records `authorizedAt`. It reloads the current preparation and keyframe brief through `CurrentKeyframeAuthoritySource`, validates their integrity and exact tenant/workspace/Story/Scene/version relationship, freezes Provider/model, and persists the fact. It must never run on page load, compilation, or worker pickup.

Equivalent delivery retries of the same confirmation request derive the same authorization ID and return the first persisted fact, including its original actor and time. A new authorization requires a new explicit human confirmation event. The authority permits exactly one image-generation call; Narrative QC and video generation are outside its scope.

The table intentionally contains no mutable consumption or result state. It does not close the cross-process crash window after Provider success and before prepared-asset commit. That durability concern requires a separately authorized execution-ledger design.
