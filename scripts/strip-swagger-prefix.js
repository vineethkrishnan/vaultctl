/**
 * Orval input transformer — strips the Go package prefix from schema names.
 * e.g. "internal_presenters_api.LoginRequest" → "LoginRequest"
 */
module.exports = (inputSchema) => {
  const prefix = "internal_presenters_api.";
  let json = JSON.stringify(inputSchema);
  json = json.replaceAll(prefix, "");
  return JSON.parse(json);
};
