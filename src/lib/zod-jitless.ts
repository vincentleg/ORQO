/**
 * Side-effect module (Nov 2026): no runtime code generation in the browser. zod 4 probes `Function("")` when an
 * object schema is CONSTRUCTED unless jitless is set, which the Content-Security-Policy reports as an eval
 * violation. Import this module FIRST in a client entry so it runs before any schema module is evaluated.
 */
import { config } from "zod";

config({ jitless: true });
