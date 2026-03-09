import {
  isProcessCommand,
  runProcessCommand,
  type ProcessCommand,
  type RunProcessCommandOptions,
} from './services/process-manager';

const HELP_FLAGS = new Set(['--help', '-h']);

export async function runCli(
  argv: string[] = process.argv,
  options: Omit<RunProcessCommandOptions, 'entrypoint'> = {},
): Promise<number> {
  const commandOrFlag = argv[2];

  if (!commandOrFlag || HELP_FLAGS.has(commandOrFlag)) {
    printUsage(options.stdout ?? process.stdout);
    return 0;
  }

  if (!isProcessCommand(commandOrFlag)) {
    const stderr = options.stderr ?? process.stderr;
    stderr.write(`Unknown command: ${commandOrFlag}\n`);
    printUsage(stderr);
    return 1;
  }

  const command = commandOrFlag as ProcessCommand;
  return await runProcessCommand(command, {
    ...options,
    entrypoint: argv[1],
  });
}

function printUsage(target: { write(chunk: string): unknown }): void {
  target.write(
    [
      'Usage: host-git-cred-proxy <command>',
      '',
      'Commands:',
      '  serve         Run service in foreground',
      '  start         Start background service and wait for health',
      '  stop          Stop background service',
      '  status        Show running and health status',
      '  open          Open panel URL in default browser',
      '  rotate-token  Rotate proxy token in state directory',
      '',
    ].join('\n'),
  );
}
