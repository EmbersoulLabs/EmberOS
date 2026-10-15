# LOCAL_GPU Character DNA + Voice DNA + Scene → R2V

## Laptop status

The Laptop can prepare one integrity-bound Contract V3 R2V handoff containing:

- the authorized `sceneExecutionId`, prompt, duration, and aspect ratio;
- the pinned Character DNA character/version/fingerprint;
- an optional immutable Voice DNA id/version/fingerprint and provider-neutral semantic instruction;
- the approved R2V reference URLs and content hashes; and
- the environment-bound upload destination.

Preparation is intentionally non-dispatching (`dispatch: false`, `submit: false`). Existing zero-asset `MINIMAX_H3_T2V` and asset R2V behavior is unchanged.

Reference-audio Voice DNA remains blocked. The handoff claims semantic voice continuity only and explicitly carries `exactAcousticVoiceContinuity: "NOT_CLAIMED"`.

## Desktop capability contract

Desktop must advertise all required claims before Laptop preparation succeeds. A pinned Voice DNA additionally requires `voiceDna: true`.

```json
{
  "contracts": {
    "v3": {
      "workflows": {
        "MINIMAX_H3_R2V": {
          "execution": "enabled",
          "referenceToVideo": true,
          "characterDna": true,
          "voiceDna": true,
          "sceneExecution": true,
          "missingModels": [],
          "e2eCertified": false
        }
      }
    }
  }
}
```

Older or partial capability responses fail closed with `LOCAL_GPU_R2V_DNA_CAPABILITY_MISMATCH`.

## Exact Desktop next action

Implement and test a Desktop Contract V3 `MINIMAX_H3_R2V` request parser for `LocalGpuR2vDnaHandoff`, recompute and verify `authorityBinding` before queueing, and return the capability block above only after Character DNA, optional descriptive/capability-bound Voice DNA, scene identity, reference hashes, and upload binding are all enforced. Keep `e2eCertified: false` until a mocked signed Laptop→Desktop round trip and a separately authorized real local-GPU certification pass.
