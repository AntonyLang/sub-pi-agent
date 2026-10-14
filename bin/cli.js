#!/usr/bin/env node
import { readFileSync } from 'node:fs';
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const args = process.argv.slice(2);
if (args.length === 1 && ['--version', '-v'].includes(args[0])) {
    process.stdout.write(`${pkg.version}\n`);
}
else if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    process.stdout.write(`sub-pi-agent ${pkg.version}
Usage: sub-pi-agent [--help | --version]

Without arguments, serves MCP over stdin/stdout. Node.js >=22.19.0 required.
Uses your existing Pi settings and authentication; never pins a model.
PI_CODING_AGENT_DIR overrides the Pi configuration directory.
PI_AGENTS_DIR overrides this MCP's persistent agent registry.
PI_STATUS_DIR overrides the status file directory and, unless PI_AGENTS_DIR is set,
the agent registry is stored beneath it in agents/.
Default state: <Pi agent directory>/mcp/sub-pi-agent/.
See https://github.com/AntonyLang/sub-pi-agent for client configuration.
`);
}
else if (args.length) {
    process.stderr.write('Unknown arguments. Run sub-pi-agent --help.\n');
    process.exitCode = 2;
}
else {
    try {
        await import('./server/index.js');
    }
    catch (error) {
        process.stderr.write(`sub-pi-agent: ${error instanceof Error ? error.message : String(error)}\n`);
        process.exitCode = 1;
    }
}
