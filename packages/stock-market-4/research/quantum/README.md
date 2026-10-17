# @quant-fusion/research-quantum

An intentional **skeleton**, not a domain model. This package exists to prove that
`@quant-fusion/research-core`'s schema is generic across a second, unrelated research domain —
using its own vocabulary (`"quantum-architecture"`, `"error-correction-code"`, ...) that
research-core never inspects — without requiring any change to research-core itself (spec §53).

```ts
import { createQuantumSkeletonDataset } from '@quant-fusion/research-quantum';
```

The fixture here is deliberately small: three entities, one relationship, one piece of evidence,
one hypothesis with a single assessment. It is not meant to represent real quantum-computing
research — building that out is future work, structured the same way
[`@quant-fusion/research-fusion`](../fusion/README.md) structures its (also representative, also
not exhaustive) fusion fixture. See that package for a fuller worked example of what a real
domain package looks like — assertions, a multi-year hypothesis confidence history, a
calculation/model, and a scenario.
