# Video Studio V1 bounded assembly — live revalidation manifest

Do not execute production validation in Assembly-B. After Assembly-C deployment, mandatory live checks:

1. New source asset persists `contentHash` (`sha256:<64 hex>`) after probe/finalize.
2. New task persists `generationInputCapsule`.
3. New task persists `generationInputFingerprint`.
4. Same-task retry preserves fingerprint/capsule.
5. 3-output generation succeeds.
6. Private signed delivery succeeds.
7. `final_ready` 720p export succeeds.
8. Worker healthy.
9. OBS events emitted and redacted (no signed URLs, prompts, tokens, secrets).
