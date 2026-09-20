// Fail-closed checkpoint. Implementation WP never executes provider writes.
const preflight = process.env.BP06_MASTER_E2E_PREFLIGHT;
const authorization = process.env.BP06_MASTER_E2E_AUTHORIZED;
const authorized = preflight === "GO" && authorization === "AUTORIZADO BP06 MASTER E2E";

console.log("BP06_MASTER_E2E_PREFLIGHT_STATUS=" + (authorized ? "authorized" : preflight === "GO" ? "awaiting_human" : "local_only"));
console.log("STOP=DO_NOT_RUN_PROVIDER_WRITES_IN_IMPLEMENTATION_WP");
process.exit(2);
