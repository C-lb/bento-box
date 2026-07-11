const path = require("path");

/**
 * Resolves the server's data and bin directories. External EE_DATA_DIR /
 * EE_BIN_DIR overrides win over the packaged defaults (userData/data and
 * <dataDir>/bin) — previously serverEnv() clobbered them unconditionally.
 */
function resolveDirs(env, userDataDir) {
  const dataDir = env.EE_DATA_DIR
    ? path.resolve(env.EE_DATA_DIR)
    : path.join(userDataDir, "data");
  const binDir = env.EE_BIN_DIR
    ? path.resolve(env.EE_BIN_DIR)
    : path.join(dataDir, "bin");
  return { dataDir, binDir };
}

module.exports = { resolveDirs };
