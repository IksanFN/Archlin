import { z } from 'zod';

// Zod probes for JIT support with Function(''). The CSP has no unsafe-eval, so even a caught probe is reported as a
// violation; interpreted validation is plenty fast for these small inputs.
z.config({ jitless: true });
