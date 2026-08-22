import { join } from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

import { AgyClient, getDefaultConfig } from './agy-client.js';
import { AgyAskClient } from './agy-ask-client.js';
import { ClineClient } from './cline-client.js';
import { ClaudeClient } from './claude-client.js';
import { createProcessDependencies } from './process-dependencies.js';
import { createNodeDelegationOps } from './node-delegation-ops.js';
import { DelegationRunner } from './delegation-runner.js';
import { ManagedDelegationService } from './managed-delegation.js';

const defaultConfig = getDefaultConfig({
  exePath: process.env.AGY_EXE_PATH || undefined,
  runsDir: process.env.AGY_RUNS_DIR || undefined,
});
const client = new AgyClient(defaultConfig);
const clineClient = new ClineClient();
const agyAskClient = new AgyAskClient();
const claudeClient = new ClaudeClient();

const repositoryRoot = process.cwd();
const worktreeRoot = join(process.cwd(), '.agy-worktrees');
const agyExecutable = process.env.AGY_EXE_PATH || defaultConfig.exePath;

const processDeps = createProcessDependencies();

const delegationService = new ManagedDelegationService({
  runnerFactory: (_manifest) => {
    const ops = createNodeDelegationOps(
      {
        repositoryRoot,
        worktreeRoot,
        agyExecutable,
      },
      processDeps
    );
    return new DelegationRunner(ops);
  },
});

function text(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

function toolError(error: unknown) {
  return {
    content: [{ type: 'text' as const, text: error instanceof Error ? error.message : String(error) }],
    isError: true,
  };
}

export function createServer() {
  const server = new McpServer({ name: 'agy-mcp-server', version: '1.0.0' });

  server.registerTool('agy_ask', {
    description: 'Run one bounded AGY task through a fresh headless bridge process.',
    inputSchema: {
      prompt: z.string().min(1),
      workspace: z.enum(['auto', 'none']).optional(),
      add_dir: z.array(z.string().min(1)).optional(),
      timeout: z.number().int().positive().max(3600).optional(),
    },
  }, async (params) => {
    try {
      return { content: [{ type: 'text' as const, text: await agyAskClient.ask(params) }] };
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('agy_submit', {
    description: 'Start a bounded AGY CLI delegation run.',
    inputSchema: {
      manifest: z.string().optional(),
      prompt: z.string().optional(),
      timeout: z.number().int().positive().max(3600).optional(),
      cwd: z.string().optional(),
      worktreePath: z.string().optional(),
      branch: z.string().optional(),
    },
  }, async (params) => {
    try {
      return text(await client.submit({ ...params, manifest: params.manifest ?? '' }));
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('cline_submit', {
    description: 'Run one bounded Cline task through the MCP host; never construct a shell command in the caller.',
    inputSchema: {
      prompt: z.string().min(1),
      cwd: z.string().min(1),
      timeout: z.number().int().positive().max(2700).optional(),
    },
  }, async (params) => {
    try {
      return text(await clineClient.submit(params));
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('claude_submit', {
    description: 'Run one bounded Claude Code task from Codex through the local non-interactive CLI.',
    inputSchema: {
      prompt: z.string().min(1),
      cwd: z.string().min(1),
      timeout: z.number().int().positive().max(2700).optional(),
    },
  }, async (params) => {
    try {
      return text(await claudeClient.submit(params));
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('agy_status', {
    description: 'Get the current state of an AGY run.',
    inputSchema: { runId: z.string().min(1) },
  }, ({ runId }) => text(client.getStatus(runId)));

  server.registerTool('agy_wait', {
    description: 'Wait for an AGY run to reach a terminal state.',
    inputSchema: { runId: z.string().min(1), timeout: z.number().int().positive().max(3600).optional() },
  }, async ({ runId, timeout }) => text(await client.wait(runId, timeout)));

  server.registerTool('agy_result', {
    description: 'Get the bounded result of a completed AGY run.',
    inputSchema: { runId: z.string().min(1) },
  }, ({ runId }) => text(client.getResult(runId)));

  server.registerTool('agy_cancel', {
    description: 'Cancel a running AGY run.',
    inputSchema: { runId: z.string().min(1) },
  }, ({ runId }) => text({ cancelled: client.cancel(runId) }));

  server.registerTool('agy_list', {
    description: 'List recent AGY runs.',
    inputSchema: { limit: z.number().int().positive().max(100).optional() },
  }, ({ limit }) => text(client.list(undefined, limit)));

  server.registerTool('agy_delegate', {
    description: 'Submit a new managed AGY task delegation.',
    inputSchema: {
      task: z.unknown(),
    },
  }, (params) => {
    try {
      return text(delegationService.submit(params.task));
    } catch (error) {
      return toolError(error);
    }
  });

  server.registerTool('delegation_status', {
    description: 'Get the current status of a managed delegation run.',
    inputSchema: {
      runId: z.string().min(1),
    },
  }, ({ runId }) => text(delegationService.status(runId)));

  server.registerTool('delegation_wait', {
    description: 'Wait for a managed delegation run to reach a terminal state.',
    inputSchema: {
      runId: z.string().min(1),
      timeout: z.number().int().positive().max(3600).optional(),
    },
  }, async ({ runId, timeout }) => text(await delegationService.wait(runId, timeout)));

  server.registerTool('delegation_result', {
    description: 'Get the bounded result of a completed managed delegation run.',
    inputSchema: {
      runId: z.string().min(1),
    },
  }, ({ runId }) => text(delegationService.result(runId)));

  server.registerTool('delegation_cancel', {
    description: 'Cancel an active managed delegation run.',
    inputSchema: {
      runId: z.string().min(1),
    },
  }, ({ runId }) => text({ cancelled: delegationService.cancel(runId) }));

  return server;
}

const server = createServer();
await server.connect(new StdioServerTransport());
