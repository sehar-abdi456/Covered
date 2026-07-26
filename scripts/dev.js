/**
 * scripts/dev.js — one-command dev runner.
 * Boots the backend (:4000) and the Vite frontend (:5173) together and pipes
 * both logs to this terminal. Ctrl-C stops both.
 */
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));

function run(name, cwd, cmd, args, color) {
  const p = spawn(cmd, args, { cwd: join(root, cwd), shell: true });
  const tag = `\x1b[${color}m[${name}]\x1b[0m`;
  p.stdout.on("data", (d) => process.stdout.write(`${tag} ${d}`));
  p.stderr.on("data", (d) => process.stderr.write(`${tag} ${d}`));
  p.on("exit", (code) => console.log(`${tag} exited (${code})`));
  return p;
}

console.log("Starting Covered (backend :4000, frontend :5173)…\n");
const backend = run("backend", "backend", "npm", ["start"], "36");
const frontend = run("frontend", "frontend", "npm", ["run", "dev"], "35");

const shutdown = () => {
  backend.kill();
  frontend.kill();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
