import fs from 'node:fs';
import path from 'node:path';

function defaultScriptExists(scriptName, baseDir) {
  return fs.existsSync(path.join(baseDir, scriptName));
}

function defaultFileExists(filePath) {
  return fs.existsSync(filePath);
}

export function isOptionalScriptAvailable(scriptName, options = {}) {
  const { baseDir = process.cwd(), scriptExists = defaultScriptExists } = options;
  return scriptExists(scriptName, baseDir);
}

export async function runOptionalDiagnosticStats(options) {
  const {
    inputPath,
    resultPath,
    scriptName = 'diagnostic_stats.py',
    baseDir = process.cwd(),
    scriptExists = defaultScriptExists,
    spawnPython,
    logger = console,
  } = options;

  if (!scriptExists(scriptName, baseDir)) {
    logger.warn(`[Public Fallback] ${scriptName} not found. Skipping diagnostic stats.`);
    return null;
  }

  return new Promise((resolve) => {
    const diag = spawnPython(scriptName, [inputPath, resultPath], 'Diagnostic Stats');
    let output = '';
    diag.stdout.on('data', (chunk) => {
      output += String(chunk);
    });
    diag.stderr.on('data', (chunk) => logger.error(`[Diagnostic Error]: ${chunk}`));
    diag.on('close', (code) => {
      if (code === 0) {
        try {
          resolve(JSON.parse(output));
        } catch (error) {
          logger.error('診斷統計 JSON 解析失敗:', error);
          resolve(null);
        }
        return;
      }

      resolve(null);
    });
  });
}

export async function runOptionalRepairAgent(options) {
  const {
    inputPath,
    outputPath,
    repairOutputPath,
    scriptName = 'repair_agent.py',
    baseDir = process.cwd(),
    scriptExists = defaultScriptExists,
    fileExists = defaultFileExists,
    spawnPython,
    logger = console,
  } = options;

  if (!scriptExists(scriptName, baseDir)) {
    logger.warn(`[Public Fallback] ${scriptName} not found. Skipping repair and using solver output.`);
    return 'original';
  }

  return new Promise((resolve) => {
    const repair = spawnPython(scriptName, [inputPath, outputPath, repairOutputPath], 'Repair Agent');
    repair.stdout.on('data', (chunk) => {
      logger.log(`[Repair Agent]: ${chunk}`);
    });
    repair.stderr.on('data', (chunk) => logger.error(`[Repair Error]: ${chunk}`));
    repair.on('close', (code) => {
      if (code === 0 && fileExists(repairOutputPath)) {
        resolve('repaired');
        return;
      }

      resolve('original');
    });
  });
}
