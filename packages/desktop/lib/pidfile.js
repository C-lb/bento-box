// Server pid bookkeeping so a relaunch can reclaim port 4571 from a previous
// instance's orphaned server (app.exit() skips before-quit, and crashes never
// reach it at all).
const { readFileSync, writeFileSync, unlinkSync } = require("node:fs");

function readPid(file) {
  try {
    const pid = Number(readFileSync(file, "utf8").trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function writePid(file, pid) {
  try {
    writeFileSync(file, String(pid));
  } catch {}
}

function clearPid(file) {
  try {
    unlinkSync(file);
  } catch {}
}

function isAlive(pid, kill = process.kill) {
  try {
    kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

module.exports = { readPid, writePid, clearPid, isAlive };
