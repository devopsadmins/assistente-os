import { spawn } from "node:child_process";
const cp = spawn("node", ["--test", "dist/test/tools.test.js"], { cwd: "D:/Projetos/assistente-os/packages/tools" });
let out = "";
cp.stdout.on("data", (c) => (out += c.toString()));
cp.stderr.on("data", (c) => (out += c.toString()));
cp.on("close", () => {
  // print only lines mentioning fail/pass/tests or AssertionError
  for (const line of out.split("\n")) {
    if (/pass|fail|tests|AssertionError|Error:|arquivo|verdict|Expected/m.test(line) || line.includes("✖") || line.includes("✔")) {
      console.log(line);
    }
  }
});
